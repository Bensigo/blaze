// Shared by request handlers and standalone background jobs.
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
