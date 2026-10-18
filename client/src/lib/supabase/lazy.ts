/**
 * Session access for components that appear on EVERY page (the header's bag and bell, the wishlist hearts on every
 * product card).
 *
 * The Supabase browser client is ~250 kB of JavaScript. Most visitors are signed out, and for them it would be
 * downloaded, parsed and run just to learn "nobody is signed in". So these helpers first check for the auth cookie
 * (the SSR client keeps the session in a readable `sb-…-auth-token` cookie) and load Supabase only if one exists.
 * Signed-out visitors never download it on the storefront; signed-in visitors load it in a separate chunk, off the
 * critical path. Pages that need Supabase itself (login, account) still import it directly.
 *
 * The one thing a signed-out page can't know is that the visitor signs in *in this tab* without a reload (email
 * sign-in does `router.push`). The sign-in and sign-out screens call `announceAuthChange()` for that.
 */
import type { Session } from "@supabase/supabase-js";

const AUTH_EVENT = "payantra:auth-changed";

/** True if a Supabase session cookie is present. A hint, not proof: the token may have expired. */
export function mightBeSignedIn(): boolean {
  return typeof document !== "undefined" && /(?:^|;\s*)sb-[^=;]*-auth-token/.test(document.cookie);
}

export async function getBrowserSession(): Promise<Session | null> {
  if (!mightBeSignedIn()) return null;
  const { createClient } = await import("./client");
  const { data } = await createClient().auth.getSession();
  return data.session;
}

/** Tells every listener that the signed-in state just changed (call after sign-in, sign-up, sign-out). */
export function announceAuthChange() {
  window.dispatchEvent(new Event(AUTH_EVENT));
}

/**
 * Calls `onChange` whenever the signed-in state may have changed: on our own announcement, and, if there is a
 * session to watch, on Supabase's token and sign-out events. Returns an unsubscribe function.
 */
export function watchAuth(onChange: () => void): () => void {
  window.addEventListener(AUTH_EVENT, onChange);
  let stopSupabase: (() => void) | null = null;
  let cancelled = false;
  if (mightBeSignedIn()) {
    void import("./client").then(({ createClient }) => {
      if (cancelled) return;
      const { data } = createClient().auth.onAuthStateChange(() => onChange());
      stopSupabase = () => data.subscription.unsubscribe();
    });
  }
  return () => {
    cancelled = true;
    window.removeEventListener(AUTH_EVENT, onChange);
    stopSupabase?.();
  };
}
