import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationMembers, users } from "@/db/schema";
import {
  emitToConv,
  emitToUser,
  handleApiError,
  isBlocked,
  requireUser,
  toPeerInfo,
} from "@/lib/server";
import type { CallPayload } from "@/lib/types";

export const runtime = "nodejs";

async function assertMember(meId: string, conversationId: string): Promise<boolean> {
  const m = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(
      and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, meId))
    )
    .limit(1);
  return !!m[0];
}

export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    if (body.type === "typing") {
      const conversationId = String(body.conversationId || "");
      if (!(await assertMember(me.id, conversationId))) {
        return NextResponse.json({ error: "Not a member" }, { status: 403 });
      }
      emitToConv(conversationId, "typing", {
        conversationId,
        userId: me.id,
        typing: !!body.typing,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.type === "call") {
      const payload = body.payload as CallPayload;
      if (!payload || !payload.toUserId || !payload.conversationId) {
        return NextResponse.json({ error: "Invalid call payload" }, { status: 400 });
      }
      if (!(await assertMember(me.id, payload.conversationId))) {
        return NextResponse.json({ error: "Not a member" }, { status: 403 });
      }
      if (!(await assertMember(payload.toUserId, payload.conversationId))) {
        return NextResponse.json({ error: "Invalid callee" }, { status: 403 });
      }
      // block check: if callee blocked caller, auto-reject
      if (await isBlocked(payload.toUserId, me.id)) {
        emitToUser(me.id, "call", {
          ...payload,
          action: "reject",
          reason: "blocked",
        });
        return NextResponse.json({ ok: true, blocked: true });
      }
      if (await isBlocked(me.id, payload.toUserId)) {
        emitToUser(payload.toUserId, "call", {
          ...payload,
          action: "reject",
          reason: "caller-blocked",
        });
        return NextResponse.json({ ok: true, blocked: true });
      }
      const fromPeer = (await db.select().from(users).where(eq(users.id, me.id)))[0];
      emitToUser(payload.toUserId, "call", {
        ...payload,
        fromPeer: fromPeer ? toPeerInfo(fromPeer) : null,
      });
      // echo back to caller so both sides stay in sync
      emitToUser(me.id, "call", { ...payload, action: "ack" });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown signal type" }, { status: 400 });
  } catch (e) {
    return handleApiError(e);
  }
}
