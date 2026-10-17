import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccountForm } from "@/components/account/account-form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSession } from "@/lib/server-session";

export const metadata: Metadata = { title: "My account", robots: { index: false } };

async function AccountBody() {
  const { me } = await requireSession("/account");
  return (
    <div className="max-w-2xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold text-primary">My account</h1>
          <p className="mt-1 text-sm text-muted-foreground">{me.email}</p>
        </div>
        {me.role === "ADMIN" && (
          <Button nativeButton={false} render={<Link href="/admin/orders" />}>
            Open admin
          </Button>
        )}
      </header>
      <AccountForm me={{ fullName: me.fullName, phone: me.phone, email: me.email }} />
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full max-w-2xl" />}>
      <AccountBody />
    </Suspense>
  );
}
