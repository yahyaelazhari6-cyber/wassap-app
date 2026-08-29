import { NextResponse } from "next/server";
import { handleApiError, requireUser, setPresence } from "@/lib/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const status = body.status === "online" ? true : false;
    await setPresence(me.id, status);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
