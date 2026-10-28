import { z } from "zod";
import { HttpError } from "@/lib/auth";
import {
  captureCors,
  capturePreflight,
  boundedJson,
} from "@/lib/session-capture";
export { capturePreflight, boundedJson };
export function captureError(error: unknown, origin: string) {
  const status =
    error instanceof HttpError
      ? error.status
      : error instanceof z.ZodError
        ? 400
        : 500;
  return Response.json(
    {
      error:
        error instanceof HttpError
          ? error.message
          : error instanceof z.ZodError
            ? "Invalid recording request."
            : "Recording request failed.",
    },
    { status, headers: origin && status !== 403 ? captureCors(origin) : {} },
  );
}
