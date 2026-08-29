import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { conversationMembers, liveLocations } from "@/db/schema";
import { emitToConv, handleApiError, requireUser } from "@/lib/server";
import type { LiveLocationDTO } from "@/lib/types";

export const runtime = "nodejs";

async function assertMember(meId: string, conversationId: string) {
  const m = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(
      and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, meId))
    )
    .limit(1);
  if (!m[0]) throw new Error("not-member");
}

export async function GET(req: Request) {
  try {
    const me = await requireUser(req);
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversationId");
    if (!conversationId) return NextResponse.json({ locations: [] });
    await assertMember(me.id, conversationId);
    const rows = await db
      .select()
      .from(liveLocations)
      .where(
        and(
          eq(liveLocations.conversationId, conversationId),
          gt(liveLocations.expiresAt, new Date())
        )
      );
    const out: LiveLocationDTO[] = rows.map((r) => ({
      userId: r.userId,
      conversationId: r.conversationId,
      lat: r.lat,
      lng: r.lng,
      accuracy: r.accuracy,
      expiresAt: r.expiresAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
    return NextResponse.json({ locations: out });
  } catch (e) {
    if (e instanceof Error && e.message === "not-member") {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }
    return handleApiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    const conversationId = String(body.conversationId || "");
    if (!conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 });
    await assertMember(me.id, conversationId);

    if (action === "share") {
      const durationMin = Math.min(Math.max(Number(body.durationMin) || 15, 1), 480);
      const expiresAt = new Date(Date.now() + durationMin * 60 * 1000);
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      if (isNaN(lat) || isNaN(lng)) {
        return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
      }
      await db
        .insert(liveLocations)
        .values({
          userId: me.id,
          conversationId,
          lat,
          lng,
          accuracy: body.accuracy ? Number(body.accuracy) : null,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: liveLocations.userId,
          set: {
            conversationId,
            lat,
            lng,
            accuracy: body.accuracy ? Number(body.accuracy) : null,
            expiresAt,
            updatedAt: new Date(),
          },
        });
      const dto: LiveLocationDTO = {
        userId: me.id,
        conversationId,
        lat,
        lng,
        accuracy: body.accuracy ? Number(body.accuracy) : null,
        expiresAt: expiresAt.toISOString(),
        updatedAt: new Date().toISOString(),
      };
      emitToConv(conversationId, "location", { ...dto, active: true });
      return NextResponse.json({ location: dto });
    }

    if (action === "update") {
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      if (isNaN(lat) || isNaN(lng)) return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
      const row = await db
        .select()
        .from(liveLocations)
        .where(and(eq(liveLocations.userId, me.id), gt(liveLocations.expiresAt, new Date())))
        .limit(1);
      if (!row[0]) return NextResponse.json({ ok: false, reason: "no-active-share" });
      const updated = new Date();
      await db
        .update(liveLocations)
        .set({ lat, lng, accuracy: body.accuracy ? Number(body.accuracy) : null, updatedAt: updated })
        .where(eq(liveLocations.userId, me.id));
      const dto: LiveLocationDTO = {
        userId: me.id,
        conversationId: row[0].conversationId,
        lat,
        lng,
        accuracy: body.accuracy ? Number(body.accuracy) : null,
        expiresAt: row[0].expiresAt.toISOString(),
        updatedAt: updated.toISOString(),
      };
      emitToConv(conversationId, "location", { ...dto, active: true });
      return NextResponse.json({ location: dto });
    }

    if (action === "stop") {
      await db.delete(liveLocations).where(eq(liveLocations.userId, me.id));
      emitToConv(conversationId, "location", {
        conversationId,
        userId: me.id,
        active: false,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof Error && e.message === "not-member") {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }
    return handleApiError(e);
  }
}
