import { ApiError } from "@/lib/api";

/** Turns an API failure into one readable sentence, including per-field validation detail. */
export function describeError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!(err instanceof ApiError)) return fallback;
  if (err.status === 401) return "Your session has expired. Please sign in again.";
  if (err.status === 403) return "You don't have permission to do that.";
  if (Array.isArray(err.details) && err.details.length) {
    const lines = (err.details as { path?: string; message?: string }[])
      .slice(0, 3)
      .map((d) => (d.path ? `${d.path}: ${d.message}` : d.message))
      .join("; ");
    return `${err.message} — ${lines}`;
  }
  return err.message || fallback;
}
