import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { conversationMembers, liveLocations, users } from "@/db/schema";
import {
  ensureJobs,
  getContactIds,
  getSessionUser,
  onConvEvent,
  onUserEvent,
  tabOffline,
  tabOnline,
} from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-Sent Events stream — the realtime backbone of the app. */
export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return new Response("Unauthorized", { status: 401 });
  ensureJobs();

  const encoder = new TextEncoder();
  const send = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (type: string, payload: unknown) => {
        try {
          controller.enqueue(send({ type, payload }));
        } catch {
          /* client gone */
        }
      };
      const unsubs: (() => void)[] = [];

      // 1) presence snapshot of all contacts
      const contacts = await getContactIds(user.id);
      if (contacts.length) {
        const contactUsers = await db.select().from(users).where(inArray(users.id, contacts));
        push(
          "presence:init",
          contactUsers.map((u) => ({
            userId: u.id,
            isOnline: u.isOnline,
            lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
          }))
        );
      }

      // 2) subscribe to user channel + conversation channels
      const userCb = (e: { type: string; payload: unknown }) => push(e.type, e.payload);
      unsubs.push(onUserEvent(user.id, userCb));
      const convs = await db
        .select({ conversationId: conversationMembers.conversationId })
        .from(conversationMembers)
        .where(eq(conversationMembers.userId, user.id));
      for (const c of convs) unsubs.push(onConvEvent(c.conversationId, userCb));

      // 3) live-location snapshot
      if (convs.length) {
        const locs = await db
          .select()
          .from(liveLocations)
          .where(
            inArray(
              liveLocations.conversationId,
              convs.map((c) => c.conversationId)
            )
          );
        push(
          "locations:init",
          locs.map((l) => ({
            userId: l.userId,
            conversationId: l.conversationId,
            lat: l.lat,
            lng: l.lng,
            accuracy: l.accuracy,
            expiresAt: l.expiresAt.toISOString(),
            updatedAt: l.updatedAt.toISOString(),
          }))
        );
      }

      // mark online (tab-aware)
      await tabOnline(user.id);

      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* noop */
        }
      }, 20000);

      const abort = () => {
        clearInterval(keepAlive);
        unsubs.forEach((u) => u());
        void tabOffline(user.id);
      };
      req.signal.addEventListener("abort", abort);
    },
    cancel() {
      /* handled by abort */
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
