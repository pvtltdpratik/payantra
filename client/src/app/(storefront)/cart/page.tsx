import type { Metadata } from "next";
import { Suspense } from "react";
import { CartView } from "@/components/cart/cart-view";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/server-session";
import type { CartView as CartData } from "@/types/commerce";

export const metadata: Metadata = { title: "Shopping bag", robots: { index: false } };

async function Body() {
  const { token } = await requireSession("/cart");
  const { data } = await api<CartData>("/cart", { token, cache: "no-store" });
  return <CartView initial={data} />;
}

export default function CartPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-8 text-4xl font-semibold text-primary">Shopping bag</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body />
      </Suspense>
    </div>
  );
}
