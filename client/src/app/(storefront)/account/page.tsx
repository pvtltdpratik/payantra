import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccountForm } from "@/components/account/account-form";
import { ProductCard } from "@/components/catalogue/product-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, isFrameworkSignal } from "@/lib/api";
import { requireSession } from "@/lib/server-session";
import type { ProductCardData } from "@/types/catalogue";

export const metadata: Metadata = { title: "My account", robots: { index: false } };

/** The shopper's own browsing trail. It is a convenience, so any failure just hides the section. */
async function RecentlyViewed({ token }: { token: string }) {
  let items: ProductCardData[] = [];
  try {
    items = (await api<ProductCardData[]>("/recently-viewed", { token, cache: "no-store" })).data.slice(0, 4);
  } catch (err) {
    if (isFrameworkSignal(err)) throw err;
    return null;
  }
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="rv-h" className="space-y-4" data-testid="recently-viewed">
      <h2 id="rv-h" className="text-2xl font-semibold">
        Recently viewed
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}

async function AccountBody() {
  const { me, token } = await requireSession("/account");
  return (
    <div className="space-y-10">
      <div className="max-w-2xl space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold text-primary">My account</h1>
            <p className="mt-1 text-sm text-muted-foreground">{me.email}</p>
          </div>
          <div className="flex gap-2">
            {me.role === "ADMIN" && (
              <Button nativeButton={false} render={<Link href="/admin" />}>
                Open admin
              </Button>
            )}
            {me.role === "DELIVERY_PARTNER" && (
              <Button nativeButton={false} render={<Link href="/delivery" />}>
                Delivery dashboard
              </Button>
            )}
          </div>
        </header>
        <AccountForm me={{ fullName: me.fullName, phone: me.phone, email: me.email }} />
      </div>
      <RecentlyViewed token={token} />
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
