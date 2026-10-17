import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client. Used for authentication only — business data goes through the Express API. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
