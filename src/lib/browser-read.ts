/** Bounded, explicitly retried reads only. Never use this to retry a mutation. */
export async function browserRead<T>(url: string, signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(url, {cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)});
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Unable to load this view. Try again.");
    return body as T;
  } catch(error) {
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) throw new Error("This view took too long to load. Try again.");
    throw error;
  }
}
