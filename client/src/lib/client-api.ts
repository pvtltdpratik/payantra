"use client";

import { api, type ApiOptions } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

/** Browser-side API call that attaches the current Supabase access token. */
export async function authedApi<T>(path: string, opts: ApiOptions = {}) {
  const { data } = await createClient().auth.getSession();
  return api<T>(path, { ...opts, token: data.session?.access_token ?? null });
}
