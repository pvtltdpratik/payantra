/**
 * Only allow same-site relative paths as post-login destinations.
 * Rejects absolute URLs, protocol-relative `//host`, and backslash tricks (open-redirect vectors).
 */
export function safeNext(value: string | null | undefined, fallback = "/account"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}
