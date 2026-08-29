import { NextResponse } from "next/server";
import { and, count, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { stories, storyViews, users } from "@/db/schema";
import {
  emitToUser,
  getContactIds,
  handleApiError,
  isBlocked,
  requireUser,
  toPeerInfo,
} from "@/lib/server";
import type { StoryDTO } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const me = await requireUser(req);
    const contactIds = await getContactIds(me.id);

    // filter out users who blocked me or whom I blocked
    const visible: string[] = [];
    for (const c of contactIds) {
      if (!(await isBlocked(me.id, c)) && !(await isBlocked(c, me.id))) visible.push(c);
    }
    const userIds = [me.id, ...visible];
    if (!userIds.length) return NextResponse.json({ stories: [] });

    const rows = await db
      .select()
      .from(stories)
      .where(and(inArray(stories.userId, userIds), gt(stories.expiresAt, new Date())))
      .orderBy(sql`${stories.createdAt} asc`);

    const authors = await db.select().from(users).where(inArray(users.id, userIds));
    const authorMap = new Map(authors.map((a) => [a.id, a]));

    const out: StoryDTO[] = [];
    for (const s of rows) {
      const author = authorMap.get(s.userId);
      if (!author) continue;
      const viewedRow = await db
        .select({ id: storyViews.storyId })
        .from(storyViews)
        .where(and(eq(storyViews.storyId, s.id), eq(storyViews.userId, me.id)))
        .limit(1);
      const viewsRow = await db
        .select({ n: count() })
        .from(storyViews)
        .where(eq(storyViews.storyId, s.id));
      out.push({
        id: s.id,
        userId: s.userId,
        type: s.type,
        content: s.content,
        bgColor: s.bgColor,
        mediaUrl: s.mediaUrl,
        expiresAt: s.expiresAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
        author: toPeerInfo(author),
        viewed: !!viewedRow[0],
        views: viewsRow[0]?.n ?? 0,
      });
    }
    return NextResponse.json({ stories: out });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const type = body.type === "image" ? "image" : "text";
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
    const [story] = await db
      .insert(stories)
      .values({
        userId: me.id,
        type,
        content: body.content ? String(body.content).slice(0, 700) : null,
        bgColor: body.bgColor ? String(body.bgColor) : null,
        mediaUrl: body.mediaUrl ? String(body.mediaUrl) : null,
        expiresAt,
      })
      .returning();

    // notify contacts
    const contacts = await getContactIds(me.id);
    const payload = { storyId: story.id, userId: me.id, type };
    for (const c of contacts) emitToUser(c, "status", payload);

    return NextResponse.json({ story: { ...story, expiresAt: story.expiresAt.toISOString(), createdAt: story.createdAt.toISOString() } });
  } catch (e) {
    return handleApiError(e);
  }
}
