/**
 * Thin typed wrapper around the Payantra Express API.
 * Every service module (products, cart, orders, ...) goes through `api()`.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/**
 * Next.js uses thrown errors with a `digest` as control-flow signals (hanging prerender fetches,
 * dynamic-usage bailouts, redirects, notFound). They must reach the framework untouched, so no
 * `catch` in this codebase may swallow or relabel them.
 */
export function isFrameworkSignal(err: unknown): boolean {
  return typeof err === "object" && err !== null && typeof (err as { digest?: unknown }).digest === "string";
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ApiError";
  }
}

interface Envelope<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
}

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Supabase access token; attach for authenticated routes. */
  token?: string | null;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const { body, token, query, headers, ...init } = opts;

  const url = new URL(`${API_URL}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (isFrameworkSignal(err)) throw err;
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Could not reach the server. Check your connection and try again.",
      undefined,
      err,
    );
  }

  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !json?.success) {
    throw new ApiError(
      res.status,
      json?.error?.code ?? "UNKNOWN",
      json?.error?.message ?? "Something went wrong",
      json?.error?.details,
    );
  }
  return { data: json.data, meta: json.meta };
}
