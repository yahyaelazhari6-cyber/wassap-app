import { randomBytes, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { and, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { db } from "@/db";
import {
  users,
  sessions,
  conversations,
  conversationMembers,
  messages,
  stories,
  blocks,
  liveLocations,
  type User,
  type Message,
} from "@/db/schema";
import type {
  ConversationDTO,
  MessageDTO,
  PeerInfo,
} from "@/lib/types";

export const SESSION_COOKIE = "wa_session";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function handleApiError(e: unknown) {
  if (e instanceof HttpError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  console.error("[api-error]", e);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

// ---------------------------------------------------------------- sessions
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await db.insert(sessions).values({ userId, token, expiresAt });
  return { token, expiresAt };
}

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  // sameSite:"none" + secure so the session survives cross-site / iframe
  // embedding (preview panes, PWA shells). "lax" cookies are silently dropped
  // there, which is what made multipart uploads fail with 401.
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.token, token));
  }
}

/** Return the raw session token string from a request (header or cookie). */
export async function getSessionTokenValue(req?: Request): Promise<string | null> {
  if (req) {
    const h = getBearerToken(req);
    if (h) return h;
  }
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Extract a session token from a request, independent of Content-Type.
 * Order: Authorization: Bearer <t>  ->  x-session-token header  ->  ?token=
 *
 * IMPORTANT: this never touches the request body, so it works identically for
 * application/json and multipart/form-data (file upload) requests.
 */
export function getBearerToken(req?: Request): string | null {
  if (!req) return null;

  // 1) Standard Authorization header (case-insensitive, tolerant of casing/space)
  const auth = req.headers.get("authorization");
  if (auth) {
    const m = /^\s*Bearer\s+(.+)\s*$/i.exec(auth);
    if (m && m[1]) return m[1].trim();
    // bare token passed without the "Bearer " prefix
    const bare = auth.trim();
    if (bare && !bare.includes(" ")) return bare;
  }

  // 2) Explicit custom header
  const custom = req.headers.get("x-session-token");
  if (custom && custom.trim()) return custom.trim();

  // 3) Query string — required for <img>/<video>/<a download> which cannot
  //    send custom headers, and as a fallback when cookies are blocked.
  try {
    const q = new URL(req.url).searchParams.get("token");
    if (q && q.trim()) return q.trim();
  } catch {
    /* relative URL — ignore */
  }

  return null;
}

/** Resolve the auth token from (in priority order) the Authorization header,
 *  then the session cookie. Enables multipart uploads to authenticate even when
 *  cookies are stripped by a proxy/CDN. */
export async function getSessionUser(req?: Request): Promise<User | null> {
  let token = req ? getBearerToken(req) : null;
  if (!token) {
    const store = await cookies();
    token = store.get(SESSION_COOKIE)?.value ?? null;
  }
  if (!token) return null;
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function requireUser(req?: Request): Promise<User> {
  const u = await getSessionUser(req);
  if (!u) throw new HttpError(401, "Not authenticated");
  return u;
}

export function toPeerInfo(u: User): PeerInfo {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    about: u.about,
    avatarUrl: u.avatarUrl,
    publicKey: u.publicKey,
    isOnline: u.isOnline,
    lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------- realtime hub
export type RealtimeEvent = { type: string; payload: unknown };
const userListeners = new Map<string, Set<(e: RealtimeEvent) => void>>();
const convListeners = new Map<string, Set<(e: RealtimeEvent) => void>>();

function addListener(
  map: Map<string, Set<(e: RealtimeEvent) => void>>,
  key: string,
  cb: (e: RealtimeEvent) => void
) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0) map.delete(key);
  };
}

export function onUserEvent(userId: string, cb: (e: RealtimeEvent) => void) {
  return addListener(userListeners, userId, cb);
}
export function onConvEvent(convId: string, cb: (e: RealtimeEvent) => void) {
  return addListener(convListeners, convId, cb);
}

export function emitToUser(userId: string, type: string, payload: unknown) {
  const set = userListeners.get(userId);
  if (!set) return;
  for (const cb of set) {
    try {
      cb({ type, payload });
    } catch (e) {
      console.error("[emit]", e);
    }
  }
}

export function emitToConv(convId: string, type: string, payload: unknown) {
  const set = convListeners.get(convId);
  if (!set) return;
  for (const cb of set) {
    try {
      cb({ type, payload });
    } catch (e) {
      console.error("[emit]", e);
    }
  }
}

// ---------------------------------------------------------------- helpers
export async function getContactIds(userId: string): Promise<string[]> {
  const convs = await db
    .select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(eq(conversationMembers.userId, userId));
  const convIds = convs.map((r) => r.conversationId);
  if (!convIds.length) return [];
  const members = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(inArray(conversationMembers.conversationId, convIds));
  return [...new Set(members.map((m) => m.userId).filter((id) => id !== userId))];
}

export async function getConversationMemberIds(convId: string): Promise<string[]> {
  const members = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, convId));
  return members.map((m) => m.userId);
}

export async function isBlocked(a: string, b: string): Promise<boolean> {
  const r = await db
    .select({ id: blocks.blockerId })
    .from(blocks)
    .where(and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)))
    .limit(1);
  return r.length > 0;
}

export async function getOrCreateDirectConversation(a: string, b: string): Promise<string> {
  const rows = await db
    .select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(eq(conversationMembers.userId, a));
  const convIds = rows.map((r) => r.conversationId);
  if (convIds.length) {
    const shared = await db
      .select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers)
      .where(and(inArray(conversationMembers.conversationId, convIds), eq(conversationMembers.userId, b)))
      .limit(1);
    if (shared[0]) return shared[0].conversationId;
  }
  const convId = randomUUID();
  await db.insert(conversations).values({ id: convId, type: "direct" });
  await db
    .insert(conversationMembers)
    .values([
      { conversationId: convId, userId: a },
      { conversationId: convId, userId: b },
    ]);
  return convId;
}

export function serializeMessage(m: Message, sender?: User | null, selfId?: string): MessageDTO {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    type: m.type,
    body: m.body,
    mediaUrl: m.mediaUrl,
    mediaName: m.mediaName,
    mediaSize: m.mediaSize,
    mime: m.mime,
    duration: m.duration,
    waveform: m.waveform,
    lat: m.lat,
    lng: m.lng,
    stickerId: m.stickerId,
    replyToId: m.replyToId,
    status: (m.status as MessageDTO["status"]) ?? "sent",
    vanishAt: m.vanishAt ? m.vanishAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
    deliveredAt: m.deliveredAt ? m.deliveredAt.toISOString() : null,
    readAt: m.readAt ? m.readAt.toISOString() : null,
    sender: sender ? toPeerInfo(sender) : undefined,
    self: selfId ? m.senderId === selfId : undefined,
  };
}

export async function serializeConversation(convId: string, meId: string): Promise<ConversationDTO> {
  const conv = (
    await db.select().from(conversations).where(eq(conversations.id, convId))
  )[0];
  if (!conv) throw new HttpError(404, "Conversation not found");
  const members = await db
    .select()
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, convId));
  const other = members.find((m) => m.userId !== meId);
  let peer: PeerInfo | null = null;
  if (other) {
    const u = (await db.select().from(users).where(eq(users.id, other.userId)))[0];
    if (u) peer = toPeerInfo(u);
  }
  const my = members.find((m) => m.userId === meId);
  const last =
    (
      await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, convId))
        .orderBy(desc(messages.createdAt))
        .limit(1)
    )[0] ?? null;

  const unreadRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, convId),
        ne(messages.senderId, meId),
        ne(messages.status, "read")
      )
    );
  const unread = unreadRows[0]?.count ?? 0;

  let lastSender: User | null = null;
  if (last) {
    lastSender = (await db.select().from(users).where(eq(users.id, last.senderId)))[0] ?? null;
  }

  return {
    id: conv.id,
    type: conv.type,
    vanishMode: conv.vanishMode,
    vanishTimer: conv.vanishTimer,
    updatedAt: conv.updatedAt.toISOString(),
    peer,
    lastMessage: last ? serializeMessage(last, lastSender, meId) : null,
    unread,
    myLastReadAt: my?.lastReadAt ? my.lastReadAt.toISOString() : null,
    blockedByMe: peer ? await isBlocked(meId, peer.id) : false,
    blockedMe: peer ? await isBlocked(peer.id, meId) : false,
  };
}

export async function listConversationsFor(meId: string): Promise<ConversationDTO[]> {
  const rows = await db
    .select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(eq(conversationMembers.userId, meId));
  const out: ConversationDTO[] = [];
  for (const r of rows) {
    try {
      out.push(await serializeConversation(r.conversationId, meId));
    } catch {
      // skip missing
    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

// ---------------------------------------------------------------- presence
export async function broadcastPresence(userId: string, isOnline: boolean, lastSeenAt: Date | null) {
  const payload = {
    userId,
    isOnline,
    lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
  };
  emitToUser(userId, "presence", payload);
  const contacts = await getContactIds(userId);
  for (const c of contacts) emitToUser(c, "presence", payload);
}

export async function setPresence(userId: string, isOnline: boolean) {
  const now = new Date();
  await db
    .update(users)
    .set({ isOnline, lastSeenAt: isOnline ? null : now })
    .where(eq(users.id, userId));
  await broadcastPresence(userId, isOnline, isOnline ? null : now);
}

// Tab-aware presence: a user is online while at least one tab is connected.
const tabCounts = new Map<string, number>();
export async function tabOnline(userId: string) {
  const n = (tabCounts.get(userId) ?? 0) + 1;
  tabCounts.set(userId, n);
  if (n === 1) await setPresence(userId, true);
}
export async function tabOffline(userId: string) {
  const n = (tabCounts.get(userId) ?? 1) - 1;
  if (n <= 0) {
    tabCounts.delete(userId);
    await setPresence(userId, false);
  } else {
    tabCounts.set(userId, n);
  }
}

// ---------------------------------------------------------------- uploads
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".zip": "application/zip",
};

export async function saveUpload(file: File): Promise<{
  url: string;
  name: string;
  size: number;
  mime: string;
}> {
  const bytes = Buffer.from(await file.arrayBuffer());
  await mkdir(UPLOAD_DIR, { recursive: true });
  const ext = path.extname(file.name || "").slice(0, 12).toLowerCase();
  const filename = `${randomUUID()}${ext}`;
  await writeFile(path.join(UPLOAD_DIR, filename), bytes);
  return {
    url: `/api/media/${filename}`,
    name: file.name || filename,
    size: bytes.length,
    mime: file.type || MIME_BY_EXT[ext] || "application/octet-stream",
  };
}

export async function loadUpload(filename: string) {
  const safe = path.basename(filename);
  const full = path.join(UPLOAD_DIR, safe);
  const data = await readFile(full);
  const ext = path.extname(safe).toLowerCase();
  return { data, mime: MIME_BY_EXT[ext] || "application/octet-stream" };
}

// ---------------------------------------------------------------- cleanup jobs
let jobsStarted = false;

export function ensureJobs() {
  if (jobsStarted) return;
  jobsStarted = true;
  setInterval(async () => {
    try {
      // vanish-mode messages
      const expired = await db
        .select({ id: messages.id, conversationId: messages.conversationId })
        .from(messages)
        .where(lt(messages.vanishAt, new Date()));
      if (expired.length) {
        const ids = expired.map((r) => r.id);
        await db.delete(messages).where(inArray(messages.id, ids));
        const byConv = new Map<string, string[]>();
        for (const r of expired) {
          const arr = byConv.get(r.conversationId) ?? [];
          arr.push(r.id);
          byConv.set(r.conversationId, arr);
        }
        for (const [convId, msgIds] of byConv) {
          emitToConv(convId, "vanished", { conversationId: convId, ids: msgIds });
        }
      }
      // expired stories + live locations
      await db.delete(stories).where(lt(stories.expiresAt, new Date()));
      await db.delete(liveLocations).where(lt(liveLocations.expiresAt, new Date()));
    } catch (e) {
      console.error("[cleanup]", e);
    }
  }, 5000);
}
