import { handleApiError, loadUpload, requireUser } from "@/lib/server";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  try {
    await requireUser(req);
    const { file } = await params;
    const { data, mime } = await loadUpload(file);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(data.length),
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
