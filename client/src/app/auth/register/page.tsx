import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Create account" };

async function Body({ searchParams }: Pick<PageProps<"/auth/register">, "searchParams">) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  return (
    <AuthShell
      title="Create your account"
      subtitle="Save addresses, track orders and keep a wishlist."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/auth/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm next={next} />
    </AuthShell>
  );
}

export default function RegisterPage({ searchParams }: PageProps<"/auth/register">) {
  return (
    <Suspense fallback={null}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
