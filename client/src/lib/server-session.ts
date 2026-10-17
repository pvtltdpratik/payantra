import "server-only";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export interface Me {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role: "CUSTOMER" | "DELIVERY_PARTNER" | "ADMIN";
  createdAt: string;
}

export interface Session {
  token: string;
  me: Me;
}

/**
 * Resolves the signed-in user for a Server Component.
 *  - `getUser()` asks Supabase to validate the JWT (cookies alone are not trusted),
 *  - the role comes from OUR API (the database), never from the token or the browser.
 * Returns null when signed out.
 */
export async function getSession(): Promise<Session | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return null;

  const { data: me } = await api<Me>("/users/me", { token, cache: "no-store" });
  return { token, me };
}

/** Redirects to sign-in (remembering where to come back to) when there is no session. */
export async function requireSession(next: string): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(`/auth/login?next=${encodeURIComponent(next)}`);
  return session;
}

export async function requireAdmin(next: string): Promise<Session> {
  const session = await requireSession(next);
  if (session.me.role !== "ADMIN") redirect("/");
  return session;
}
