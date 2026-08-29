import { NextResponse } from "next/server";
import { handleApiError, requireUser, saveUpload } from "@/lib/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await requireUser(req);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const saved = await saveUpload(file);
    return NextResponse.json(saved);
  } catch (e) {
    return handleApiError(e);
  }
}
