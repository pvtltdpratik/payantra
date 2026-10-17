import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

async function Body({ searchParams }: Pick<PageProps<"/auth/login">, "searchParams">) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  const notice = sp.error === "callback" ? "That sign-in link is invalid or has expired. Please try again." : undefined;
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to track orders and checkout faster."
      footer={
        <>
          New to Payantra?{" "}
          <Link href={`/auth/register${next !== "/account" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-primary underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm next={next} notice={notice} />
    </AuthShell>
  );
}

export default function LoginPage({ searchParams }: PageProps<"/auth/login">) {
  return (
    <Suspense fallback={null}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
