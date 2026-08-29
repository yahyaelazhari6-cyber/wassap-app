import { NextResponse } from "next/server";
import {
  getOrCreateDirectConversation,
  handleApiError,
  listConversationsFor,
  requireUser,
  serializeConversation,
} from "@/lib/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const me = await requireUser(req);
    const convs = await listConversationsFor(me.id);
    return NextResponse.json({ conversations: convs });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    if (!body.userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    if (body.userId === me.id) {
      return NextResponse.json({ error: "Cannot chat with yourself" }, { status: 400 });
    }
    const convId = await getOrCreateDirectConversation(me.id, String(body.userId));
    const conv = await serializeConversation(convId, me.id);
    return NextResponse.json({ conversation: conv });
  } catch (e) {
    return handleApiError(e);
  }
}
