import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { blocks, conversationMembers, conversations, messages } from "@/db/schema";
import {
  emitToConv,
  getConversationMemberIds,
  handleApiError,
  requireUser,
  serializeConversation,
} from "@/lib/server";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser(req);
    const { id } = await params;
    const conv = await serializeConversation(id, me.id);
    return NextResponse.json({ conversation: conv });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    // verify membership
    const member = await db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, me.id)))
      .limit(1);
    if (!member[0]) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    if (action === "read") {
      const now = new Date();
      await db
        .update(conversationMembers)
        .set({ lastReadAt: now })
        .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, me.id)));
      const incoming = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, id),
            ne(messages.senderId, me.id),
            ne(messages.status, "read")
          )
        );
      const ids = incoming.map((m) => m.id);
      if (ids.length) {
        await db
          .update(messages)
          .set({ status: "read", readAt: now })
          .where(
            and(
              eq(messages.conversationId, id),
              ne(messages.senderId, me.id),
              ne(messages.status, "read")
            )
          );
        emitToConv(id, "receipts", { conversationId: id, ids, status: "read" });
      }
      return NextResponse.json({ ok: true, readIds: ids });
    }

    if (action === "vanish") {
      const vanishMode = !!body.vanishMode;
      const timer = Math.min(Math.max(Number(body.vanishTimer) || 60, 5), 3600);
      await db
        .update(conversations)
        .set({ vanishMode, vanishTimer: timer })
        .where(eq(conversations.id, id));
      emitToConv(id, "vanish", { conversationId: id, vanishMode, vanishTimer: timer });
      return NextResponse.json({ ok: true });
    }

    if (action === "block" || action === "unblock") {
      const targetId = String(body.userId || "");
      if (!targetId) return NextResponse.json({ error: "userId required" }, { status: 400 });
      if (action === "block") {
        await db
          .insert(blocks)
          .values({ blockerId: me.id, blockedId: targetId })
          .onConflictDoNothing();
      } else {
        await db
          .delete(blocks)
          .where(and(eq(blocks.blockerId, me.id), eq(blocks.blockedId, targetId)));
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      const memberIds = await getConversationMemberIds(id);
      await db.delete(conversations).where(eq(conversations.id, id));
      for (const uid of memberIds) {
        emitToConv(id, "conv-deleted", { conversationId: id });
        void uid;
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return handleApiError(e);
  }
}
