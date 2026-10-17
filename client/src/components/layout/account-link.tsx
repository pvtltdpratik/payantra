import Link from "next/link";
import { connection } from "next/server";
import { User } from "lucide-react";
import { isFrameworkSignal } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const linkClass =
  "inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2";

/** Reads the session cookie, so it must render at request time inside a <Suspense>. */
export async function AccountLink() {
  await connection();

  let email: string | null = null;
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      email = data.user?.email ?? null;
    }
  } catch (err) {
    if (isFrameworkSignal(err)) throw err;
    email = null; // a broken auth backend must never take the storefront down
  }

  if (!email) {
    return (
      <Link href="/auth/login" className={linkClass}>
        <User aria-hidden className="size-4" />
        <span className="hidden sm:inline">Sign in</span>
        <span className="sr-only sm:hidden">Sign in</span>
      </Link>
    );
  }

  return (
    <Link href="/account" className={linkClass} aria-label={`My account (${email})`}>
      <span aria-hidden className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold uppercase text-primary-foreground">
        {email[0]}
      </span>
      <span className="hidden sm:inline">Account</span>
    </Link>
  );
}
