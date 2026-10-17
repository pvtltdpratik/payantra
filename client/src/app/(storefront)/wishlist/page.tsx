import type { Metadata } from "next";
import Link from "next/link";
import { Heart } from "lucide-react";
import { Suspense } from "react";
import { ProductCard } from "@/components/catalogue/product-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/server-session";
import type { ProductCardData } from "@/types/catalogue";

export const metadata: Metadata = { title: "My wishlist", robots: { index: false } };

async function Body() {
  const { token } = await requireSession("/wishlist");
  const { data } = await api<ProductCardData[]>("/wishlist", { token, cache: "no-store" });

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card px-6 py-20 text-center">
        <Heart aria-hidden className="mx-auto size-10 text-muted-foreground" />
        <h2 className="mt-4 text-3xl font-semibold">Nothing saved yet</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Tap the heart on anything you love and it will wait for you here.</p>
        <Button className="mt-6 h-11 px-6" nativeButton={false} render={<Link href="/shop" />}>
          Explore the collection
        </Button>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 xl:grid-cols-4">
      {data.map((p) => (
        <li key={p.id}>
          <ProductCard product={p} />
        </li>
      ))}
    </ul>
  );
}

export default function WishlistPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="mb-8 text-4xl font-semibold text-primary">Wishlist</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body />
      </Suspense>
    </div>
  );
}
