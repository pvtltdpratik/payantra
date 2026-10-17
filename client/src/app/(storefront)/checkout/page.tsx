import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/server-session";
import type { Address, CartView, CheckoutOptions } from "@/types/commerce";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

async function Body() {
  const { token } = await requireSession("/checkout");
  const [cart, addresses, options] = await Promise.all([
    api<CartView>("/cart", { token, cache: "no-store" }),
    api<Address[]>("/addresses", { token, cache: "no-store" }),
    api<CheckoutOptions>("/checkout/options", { token, cache: "no-store" }),
  ]);

  // Nothing to pay for, or something in the bag needs fixing first: the bag page explains what.
  if (cart.data.items.length === 0 || !cart.data.canCheckout) redirect("/cart");

  return <CheckoutForm cart={cart.data} initialAddresses={addresses.data} options={options.data} />;
}

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-8 text-4xl font-semibold text-primary">Checkout</h1>
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <Body />
      </Suspense>
    </div>
  );
}
