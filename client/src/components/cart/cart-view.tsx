"use client";

import Link from "next/link";
import { useState } from "react";
import { Minus, Plus, ShoppingBag, Tag, Trash2 } from "lucide-react";
import { ProductImage } from "@/components/catalogue/product-image";
import { describeError } from "@/components/admin/api-error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notifyCartChanged } from "@/lib/cart-events";
import { authedApi } from "@/lib/client-api";
import { formatINR } from "@/lib/utils";
import type { CartView as CartData } from "@/types/commerce";
import { OrderSummary } from "./order-summary";

const ISSUE_TEXT = {
  UNAVAILABLE: "No longer available",
  OUT_OF_STOCK: "Sold out",
  INSUFFICIENT_STOCK: "Not enough in stock",
} as const;

export function CartView({ initial }: { initial: CartData }) {
  const [cart, setCart] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function run(key: string, call: () => Promise<{ data: CartData }>) {
    setBusy(key);
    setError(null);
    try {
      const res = await call();
      setCart(res.data); // the server's recomputed cart is the only source of truth
      notifyCartChanged();
      return true;
    } catch (err) {
      setError(describeError(err, "We couldn't update your bag. Please try again."));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const setQty = (variantId: string, quantity: number) =>
    run(variantId, () => authedApi<CartData>(`/cart/items/${variantId}`, { method: "PATCH", body: { quantity } }));
  const remove = (variantId: string) => run(variantId, () => authedApi<CartData>(`/cart/items/${variantId}`, { method: "DELETE" }));

  async function applyCoupon(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    if (await run("coupon", () => authedApi<CartData>("/cart/coupon", { method: "PUT", body: { code: code.trim() } }))) setCode("");
  }

  if (cart.items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card px-6 py-20 text-center">
        <ShoppingBag aria-hidden className="mx-auto size-10 text-muted-foreground" />
        <h2 className="mt-4 text-3xl font-semibold">Your bag is empty</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Find something you love — new arrivals land every week.</p>
        <Button className="mt-6 h-11 px-6" nativeButton={false} render={<Link href="/shop" />}>
          Continue shopping
        </Button>
      </div>
    );
  }

  const blocked = cart.items.filter((i) => i.issue);
  const p = cart.pricing;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_24rem]">
      <section aria-label="Items in your bag" className="space-y-1">
        {error && (
          <p role="alert" className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {blocked.length > 0 && (
          <p role="alert" className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            Some items need your attention before you can check out.
          </p>
        )}

        <ul className="divide-y">
          {cart.items.map((i) => (
            <li key={i.variantId} className="flex gap-4 py-5" data-testid="cart-line">
              <Link href={`/product/${i.slug}`} className="relative block aspect-[4/5] w-24 shrink-0 overflow-hidden rounded-md bg-muted sm:w-28">
                {i.image && <ProductImage src={i.image.url} alt={i.image.alt ?? i.name} sizes="112px" />}
              </Link>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/product/${i.slug}`} className="line-clamp-2 font-serif text-lg font-semibold leading-snug hover:text-primary">
                      {i.name}
                    </Link>
                    <p className="mt-0.5 text-sm text-muted-foreground">{[i.colour, i.size && `Size ${i.size}`].filter(Boolean).join(" · ")}</p>
                  </div>
                  <p className="text-right text-base font-medium tabular-nums">{formatINR(i.lineTotal)}</p>
                </div>

                {i.issue && (
                  <p role="status" className="mt-1 text-sm font-medium text-destructive">
                    {ISSUE_TEXT[i.issue]}
                    {i.issue === "INSUFFICIENT_STOCK" && ` — only ${i.available} left`}
                  </p>
                )}

                <div className="mt-auto flex items-center justify-between pt-3">
                  <div role="group" aria-label={`Quantity for ${i.name}`} className="inline-flex h-9 items-center rounded-md border border-input bg-card">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      disabled={i.quantity <= 1 || busy === i.variantId}
                      onClick={() => setQty(i.variantId, i.quantity - 1)}
                      className="grid h-full w-9 place-items-center disabled:opacity-40"
                    >
                      <Minus aria-hidden className="size-3.5" />
                    </button>
                    <span className="w-7 text-center text-sm tabular-nums" data-testid="line-qty">
                      {i.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      disabled={i.quantity >= i.maxQuantity || busy === i.variantId}
                      onClick={() => setQty(i.variantId, i.quantity + 1)}
                      className="grid h-full w-9 place-items-center disabled:opacity-40"
                    >
                      <Plus aria-hidden className="size-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(i.variantId)}
                    disabled={busy === i.variantId}
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 aria-hidden className="size-4" /> Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <aside aria-label="Order summary" className="h-fit space-y-5 rounded-xl border bg-card p-5 lg:sticky lg:top-24">
        <h2 className="text-2xl font-semibold">Order summary</h2>

        <form onSubmit={applyCoupon} className="space-y-2">
          <label htmlFor="coupon" className="text-sm font-medium">
            Have a coupon?
          </label>
          {p.couponCode ? (
            <div className="flex items-center justify-between rounded-md border border-success/40 bg-success/5 px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-2 font-medium text-success">
                <Tag aria-hidden className="size-4" /> {p.couponCode} applied
              </span>
              <button type="button" className="text-muted-foreground underline" onClick={() => run("coupon", () => authedApi<CartData>("/cart/coupon", { method: "DELETE" }))}>
                Remove
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input id="coupon" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter code" autoCapitalize="characters" className="h-10 uppercase" />
              <Button type="submit" variant="outline" className="h-10" disabled={busy === "coupon" || !code.trim()}>
                Apply
              </Button>
            </div>
          )}
          {p.couponNote && <p className="text-xs text-warning">{p.couponNote}</p>}
        </form>

        <OrderSummary pricing={p} />

        {p.freeShippingRemaining > 0 && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            Add <strong>{formatINR(p.freeShippingRemaining)}</strong> more for free delivery.
          </p>
        )}

        {cart.canCheckout ? (
          <Button className="h-12 w-full text-base" nativeButton={false} render={<Link href="/checkout" />}>
            Proceed to checkout
          </Button>
        ) : (
          <Button className="h-12 w-full text-base" disabled>
            Fix the items above to continue
          </Button>
        )}
        <p className="text-center text-xs text-muted-foreground">Secure payment via Razorpay. Prices include GST.</p>
      </aside>
    </div>
  );
}
