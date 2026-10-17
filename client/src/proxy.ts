import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

const PROTECTED_PREFIXES = ["/admin", "/account", "/cart", "/checkout", "/wishlist", "/delivery"];

/**
 * 1. Sends visitors with no session cookie to sign-in, remembering the exact page they wanted.
 *    This is a convenience fast-path only: the cookie's presence proves nothing, so every protected
 *    Server Component re-validates the session and the API enforces roles on its own.
 * 2. Refreshes the Supabase session cookies on navigation.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasAuthCookie = request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));

  if (isProtected && !hasAuthCookie) {
    const login = new URL("/auth/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  return updateSession(request);
}

export const config = {
  // Everything except static assets and the placeholder artwork route.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|placeholder).*)"],
};
