import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { stories, storyViews } from "@/db/schema";
import { handleApiError, requireUser } from "@/lib/server";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser(req);
    const { id } = await params;
    const story = (await db.select().from(stories).where(eq(stories.id, id)))[0];
    if (!story) return NextResponse.json({ error: "Story not found" }, { status: 404 });
    if (story.userId === me.id) {
      return NextResponse.json({ ok: true, views: 0 });
    }
    await db
      .insert(storyViews)
      .values({ storyId: id, userId: me.id })
      .onConflictDoNothing();
    const viewsRow = await db
      .select({ n: count() })
      .from(storyViews)
      .where(eq(storyViews.storyId, id));
    return NextResponse.json({ ok: true, views: viewsRow[0]?.n ?? 0 });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser(req);
    const { id } = await params;
    const story = (await db.select().from(stories).where(eq(stories.id, id)))[0];
    if (!story) return NextResponse.json({ error: "Story not found" }, { status: 404 });
    if (story.userId !== me.id) {
      return NextResponse.json({ error: "Not your story" }, { status: 403 });
    }
    await db.delete(stories).where(eq(stories.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
