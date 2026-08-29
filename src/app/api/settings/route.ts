import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { blocks, users } from "@/db/schema";
import { handleApiError, HttpError, requireUser, toPeerInfo } from "@/lib/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const me = await requireUser(req);
    const rows = await db
      .select({ blocked: users })
      .from(blocks)
      .innerJoin(users, eq(blocks.blockedId, users.id))
      .where(eq(blocks.blockerId, me.id));
    return NextResponse.json({
      me: toPeerInfo(me),
      theme: me.theme,
      blocked: rows.map((r) => toPeerInfo(r.blocked)),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const me = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "profile") {
      const displayName = body.displayName ? String(body.displayName).slice(0, 40) : undefined;
      const about = body.about !== undefined ? String(body.about).slice(0, 140) : undefined;
      const avatarUrl = body.avatarUrl !== undefined ? String(body.avatarUrl).slice(0, 300) : undefined;
      await db
        .update(users)
        .set({
          ...(displayName !== undefined ? { displayName } : {}),
          ...(about !== undefined ? { about } : {}),
          ...(avatarUrl !== undefined ? { avatarUrl } : {}),
        })
        .where(eq(users.id, me.id));
      const updated = (await db.select().from(users).where(eq(users.id, me.id)))[0];
      return NextResponse.json({ user: toPeerInfo(updated) });
    }

    if (action === "theme") {
      const theme = ["light", "dark", "amoled"].includes(String(body.theme))
        ? String(body.theme)
        : "dark";
      await db.update(users).set({ theme }).where(eq(users.id, me.id));
      return NextResponse.json({ theme });
    }

    if (action === "password") {
      const { currentPassword, newPassword, privateKeyEnc, kekSalt, kekIv } = body;
      if (!currentPassword || !newPassword || !privateKeyEnc || !kekSalt || !kekIv) {
        throw new HttpError(400, "Missing required fields");
      }
      if (String(newPassword).length < 6) {
        throw new HttpError(400, "Password must be at least 6 characters");
      }
      if (!(await bcrypt.compare(String(currentPassword), me.passwordHash))) {
        throw new HttpError(401, "Current password is incorrect");
      }
      const passwordHash = await bcrypt.hash(String(newPassword), 10);
      await db
        .update(users)
        .set({
          passwordHash,
          privateKeyEnc: String(privateKeyEnc),
          kekSalt: String(kekSalt),
          kekIv: String(kekIv),
        })
        .where(eq(users.id, me.id));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return handleApiError(e);
  }
}
