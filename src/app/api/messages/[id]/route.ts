import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationMembers, conversations, messages } from "@/db/schema";
import { emitToConv, handleApiError, requireUser } from "@/lib/server";

export const runtime = "nodejs";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser(req);
    const { id } = await params;
    const msg = (await db.select().from(messages).where(eq(messages.id, id)))[0];
    if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });

    const member = await db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(
        and(eq(conversationMembers.conversationId, msg.conversationId), eq(conversationMembers.userId, me.id))
      )
      .limit(1);
    if (!member[0]) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const conv = (
      await db.select().from(conversations).where(eq(conversations.id, msg.conversationId))
    )[0];
    const isOwner = msg.senderId === me.id;
    if (!isOwner && !(conv && conv.vanishMode)) {
      return NextResponse.json({ error: "You can only delete your own messages" }, { status: 403 });
    }

    await db.delete(messages).where(eq(messages.id, id));
    emitToConv(msg.conversationId, "deleted", {
      conversationId: msg.conversationId,
      ids: [id],
      reason: "delete",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
