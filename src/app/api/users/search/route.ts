import { NextResponse } from "next/server";
import { and, eq, ilike, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { blocks, users } from "@/db/schema";
import { handleApiError, requireUser, toPeerInfo, isBlocked } from "@/lib/server";
import type { UserSearchResult } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const me = await requireUser(req);
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const limit = Math.min(Number(url.searchParams.get("limit") || 20), 50);

    let rows: (typeof users.$inferSelect)[] = [];
    if (q.length >= 2) {
      rows = await db
        .select()
        .from(users)
        .where(
          and(
            ne(users.id, me.id),
            or(ilike(users.username, `%${q}%`), ilike(users.displayName, `%${q}%`))
          )
        )
        .limit(limit);
    }

    const out: UserSearchResult[] = [];
    for (const u of rows) {
      out.push({
        ...toPeerInfo(u),
        blockedByMe: await isBlocked(me.id, u.id),
        blockedMe: await isBlocked(u.id, me.id),
      });
    }
    return NextResponse.json({ results: out });
  } catch (e) {
    return handleApiError(e);
  }
}
