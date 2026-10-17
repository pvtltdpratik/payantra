import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps the Supabase session fresh on navigation: access tokens are short-lived, and only the
 * proxy (not Server Components) is allowed to write the refreshed cookies back to the browser.
 */
export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const response = NextResponse.next({ request });

  // Anonymous visitors carry no Supabase cookie; skip the network round-trip entirely.
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
  if (!url || !key || !hasSession) return response;

  let out = response;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        out = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => out.cookies.set(name, value, options));
      },
    },
  });

  try {
    // Validates the JWT with Supabase and rotates it when close to expiry.
    await supabase.auth.getUser();
  } catch {
    // Auth backend unreachable: let the request through; protected pages re-check on their own.
  }
  return out;
}
