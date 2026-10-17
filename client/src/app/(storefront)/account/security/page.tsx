import type { Metadata } from "next";
import { Suspense } from "react";
import { SecurityForm } from "@/components/account/security-form";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSession } from "@/lib/server-session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account security", robots: { index: false } };

async function Body() {
  const { me } = await requireSession("/account/security");
  // Google sign-in accounts have no password of their own; the identity provider says how this person signs in.
  const { data } = await (await createClient()).auth.getUser();
  const providers = (data.user?.app_metadata?.providers as string[] | undefined) ?? [];
  const hasPassword = providers.length === 0 || providers.includes("email");
  return <SecurityForm email={me.email} hasPassword={hasPassword} />;
}

export default function AccountSecurityPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-4xl font-semibold text-primary">Security</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body />
      </Suspense>
    </div>
  );
}
