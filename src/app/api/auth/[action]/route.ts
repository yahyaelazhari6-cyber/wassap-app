import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  createSession,
  setSessionCookie,
  clearSession,
  getSessionUser,
  getSessionTokenValue,
  toPeerInfo,
  handleApiError,
  HttpError,
  SESSION_COOKIE,
} from "@/lib/server";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await params;
    const body = await req.json().catch(() => ({}));

    if (action === "register") {
      const { username, password, displayName, about, publicKey, privateKeyEnc, kekSalt, kekIv } = body;
      if (!username || !password || !publicKey || !privateKeyEnc || !kekSalt || !kekIv) {
        throw new HttpError(400, "Missing required fields");
      }
      const uname = String(username).trim().toLowerCase();
      if (!/^[a-z0-9_.]{3,24}$/.test(uname)) {
        throw new HttpError(400, "Username must be 3-24 characters (letters, numbers, _ or .)");
      }
      if (String(password).length < 6) {
        throw new HttpError(400, "Password must be at least 6 characters");
      }
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, uname)).limit(1);
      if (existing[0]) throw new HttpError(409, "Username already taken");
      const passwordHash = await bcrypt.hash(String(password), 10);
      const [user] = await db
        .insert(users)
        .values({
          username: uname,
          passwordHash,
          displayName: String(displayName || uname).slice(0, 40),
          about: String(about || "").slice(0, 140),
          publicKey: String(publicKey),
          privateKeyEnc: String(privateKeyEnc),
          kekSalt: String(kekSalt),
          kekIv: String(kekIv),
        })
        .returning();
      const { token, expiresAt } = await createSession(user.id);
      const res = NextResponse.json({
        user: toPeerInfo(user),
        token,
        privateKeyEnc: user.privateKeyEnc,
        kekSalt: user.kekSalt,
        kekIv: user.kekIv,
      });
      setSessionCookie(res, token, expiresAt);
      return res;
    }

    if (action === "login") {
      const { username, password } = body;
      if (!username || !password) throw new HttpError(400, "Username and password required");
      const uname = String(username).trim().toLowerCase();
      const user = (await db.select().from(users).where(eq(users.username, uname)).limit(1))[0];
      if (!user || !(await bcrypt.compare(String(password), user.passwordHash))) {
        throw new HttpError(401, "Invalid username or password");
      }
      const { token, expiresAt } = await createSession(user.id);
      const res = NextResponse.json({
        user: toPeerInfo(user),
        token,
        privateKeyEnc: user.privateKeyEnc,
        kekSalt: user.kekSalt,
        kekIv: user.kekIv,
      });
      setSessionCookie(res, token, expiresAt);
      return res;
    }

    if (action === "logout") {
      await clearSession();
      const res = NextResponse.json({ ok: true });
      res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
      return res;
    }

    throw new HttpError(404, "Unknown action");
  } catch (e) {
    return handleApiError(e);
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await params;
    if (action === "me") {
      const user = await getSessionUser(req);
      if (!user) return NextResponse.json({ user: null });
      const token = await getSessionTokenValue(req);
      return NextResponse.json({
        user: toPeerInfo(user),
        token,
        privateKeyEnc: user.privateKeyEnc,
        kekSalt: user.kekSalt,
        kekIv: user.kekIv,
      });
    }
    throw new HttpError(404, "Unknown action");
  } catch (e) {
    return handleApiError(e);
  }
}
