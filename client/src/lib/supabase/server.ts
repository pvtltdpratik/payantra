import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server-component / route-handler Supabase client bound to the request's cookies. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => {
          try {
            items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component: cookies are read-only there. Safe to ignore;
            // the proxy/middleware refreshes the session.
          }
        },
      },
    },
  );
}
