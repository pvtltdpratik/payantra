import { NextResponse } from "next/server";
import { safeNext } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth (Google) and email-link callback. Supabase redirects here with a one-time `code`
 * which is exchanged for a session cookie, then the shopper continues to `next`.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/auth/login?error=callback`);
}
