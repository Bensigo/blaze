import {
  uploadCapture,
  captureCors,
  CAPTURE_MAX_BYTES,
} from "@/lib/session-capture";
import { HttpError } from "@/lib/auth";
import { captureError, capturePreflight } from "../shared";
export const OPTIONS = capturePreflight;
export const maxDuration = 60;
export async function POST(request: Request) {
  const origin = request.headers.get("origin") || "";
  if (!origin) return new Response(null, { status: 403 });
  try {
    const max = CAPTURE_MAX_BYTES + 65536;
    if (Number(request.headers.get("content-length") || 0) > max)
      throw new HttpError(413, "Recording exceeds 3 MiB.");
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, "Missing recording.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new HttpError(413, "Recording exceeds 3 MiB.");
      }
      chunks.push(r.value);
    }
    const copy = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type") || "" },
      body: new Uint8Array(Buffer.concat(chunks)),
    });
    return Response.json(await uploadCapture(await copy.formData(), origin), {
      headers: captureCors(origin),
    });
  } catch (e) {
    return captureError(e, origin);
  }
}
