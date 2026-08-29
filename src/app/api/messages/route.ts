import { NextResponse } from "next/server";
import { and, desc, eq, ilike, inArray, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import { conversationMembers, conversations, messages, users } from "@/db/schema";
import {
  emitToConv,
  emitToUser,
  getConversationMemberIds,
  handleApiError,
  HttpError,
  isBlocked,
  requireUser,
  serializeMessage,
} from "@/lib/server";
import type { MessageDTO } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const me = await requireUser(req);
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversationId");
    const before = url.searchParams.get("before");
    const type = url.searchParams.get("type");
    const filter = url.searchParams.get("filter");
    const limit = Math.min(Number(url.searchParams.get("limit") || 40), 100);

    let convIds: string[] = [];
    if (conversationId) {
      const member = await db
        .select({ userId: conversationMembers.userId })
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, me.id)
          )
        )
        .limit(1);
      if (!member[0]) return NextResponse.json({ error: "Not a member" }, { status: 403 });
      convIds = [conversationId];
    } else {
      const rows = await db
        .select({ conversationId: conversationMembers.conversationId })
        .from(conversationMembers)
        .where(eq(conversationMembers.userId, me.id));
      convIds = rows.map((r) => r.conversationId);
    }

    const conds = [inArray(messages.conversationId, convIds)];
    if (before) conds.push(lt(messages.createdAt, new Date(before)));
    if (type === "call") conds.push(eq(messages.type, "call"));
    if (filter === "media") conds.push(inArray(messages.type, ["image", "video", "audio"]));
    if (filter === "docs") conds.push(eq(messages.type, "document"));
    if (filter === "links") conds.push(ilike(messages.body, "%http%"));

    const rows = await db
      .select()
      .from(messages)
      .where(and(...conds))
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    const senders = await db.select().from(users).where(inArray(users.id, [...new Set(rows.map((r) => r.senderId))]));
    const senderMap = new Map(senders.map((s) => [s.id, s]));
    const list: MessageDTO[] = rows
      .map((m) => serializeMessage(m, senderMap.get(m.senderId), me.id))
      .reverse();
    return NextResponse.json({ messages: list });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    // -------- receipt acks --------
    if (body.action === "delivered" || body.action === "read") {
      const conversationId = String(body.conversationId || "");
      if (!conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 });
      const status = body.action === "delivered" ? "delivered" : "read";
      const now = new Date();
      if (status === "read") {
        await db
          .update(conversationMembers)
          .set({ lastReadAt: now })
          .where(
            and(
              eq(conversationMembers.conversationId, conversationId),
              eq(conversationMembers.userId, me.id)
            )
          );
      }
      const rows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            ne(messages.senderId, me.id),
            status === "read" ? ne(messages.status, "read") : eq(messages.status, "sent")
          )
        );
      const ids = rows.map((r) => r.id);
      if (ids.length) {
        await db
          .update(messages)
          .set(
            status === "read"
              ? { status: "read", readAt: now }
              : { status: "delivered", deliveredAt: now }
          )
          .where(inArray(messages.id, ids));
        emitToConv(conversationId, "receipts", { conversationId, ids, status });
      }
      return NextResponse.json({ ok: true, ids });
    }

    // -------- send message --------
    const conversationId = String(body.conversationId || "");
    if (!conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 });
    const member = await db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(
        and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, me.id))
      )
      .limit(1);
    if (!member[0]) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const memberIds = await getConversationMemberIds(conversationId);
    const peerId = memberIds.find((u) => u !== me.id);
    if (peerId && (await isBlocked(me.id, peerId))) {
      throw new HttpError(403, "You blocked this user");
    }
    if (peerId && (await isBlocked(peerId, me.id))) {
      throw new HttpError(403, "This user blocked you");
    }

    const conv = (
      await db.select().from(conversations).where(eq(conversations.id, conversationId))
    )[0];
    if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

    const msgType = String(body.type || "text");
    const now = new Date();
    const vanishAt = conv.vanishMode
      ? new Date(now.getTime() + (conv.vanishTimer || 60) * 1000)
      : null;

    const [inserted] = await db
      .insert(messages)
      .values({
        conversationId,
        senderId: me.id,
        type: msgType,
        body: body.body ? String(body.body).slice(0, 50000) : null,
        mediaUrl: body.mediaUrl ? String(body.mediaUrl) : null,
        mediaName: body.mediaName ? String(body.mediaName).slice(0, 255) : null,
        mediaSize: body.mediaSize ? Number(body.mediaSize) : null,
        mime: body.mime ? String(body.mime).slice(0, 100) : null,
        duration: body.duration ? Number(body.duration) : null,
        waveform: body.waveform ? String(body.waveform).slice(0, 4000) : null,
        lat: body.lat !== undefined ? Number(body.lat) : null,
        lng: body.lng !== undefined ? Number(body.lng) : null,
        stickerId: body.stickerId ? String(body.stickerId) : null,
        replyToId: body.replyToId ? String(body.replyToId) : null,
        status: "sent",
        vanishAt,
        createdAt: now,
      })
      .returning();

    await db
      .update(conversations)
      .set({ updatedAt: now })
      .where(eq(conversations.id, conversationId));

    const sender = (await db.select().from(users).where(eq(users.id, me.id)))[0];
    const dto = serializeMessage(inserted, sender, me.id);

    // deliver to all members via their user channels
    for (const uid of memberIds) {
      emitToUser(uid, "message", dto);
    }
    return NextResponse.json({ message: dto });
  } catch (e) {
    return handleApiError(e);
  }
}
