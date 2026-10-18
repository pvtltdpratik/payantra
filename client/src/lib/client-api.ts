"use client";

import { api, type ApiOptions } from "@/lib/api";
import { getBrowserSession } from "@/lib/supabase/lazy";

/** Browser-side API call that attaches the current Supabase access token. */
export async function authedApi<T>(path: string, opts: ApiOptions = {}) {
  const session = await getBrowserSession();
  return api<T>(path, { ...opts, token: session?.access_token ?? null });
}
