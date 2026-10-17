/**
 * supabase-js reports transport failures (DNS, offline, 5xx) as a returned `error` rather than a
 * thrown exception. They must be told apart from "wrong password" so users aren't misled.
 */
export function isNetworkAuthError(error: { name?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  return error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status !== undefined && error.status >= 500);
}
