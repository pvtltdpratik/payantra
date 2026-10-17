"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { notifyCartChanged } from "@/lib/cart-events";
import { authedApi } from "@/lib/client-api";
import { createClient } from "@/lib/supabase/client";
import type { ProductVariantData } from "@/types/catalogue";

export function AddToBag({ variant, productName }: { variant: ProductVariantData | undefined; productName: string }) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const max = Math.max(1, Math.min(variant?.available ?? 1, 10));
  const unavailable = !variant || variant.stockStatus === "OUT_OF_STOCK";
  const safeQty = Math.min(qty, max); // the chosen variant may allow fewer than the last one did

  async function add() {
    if (!variant || unavailable) return;
    setError(null);
    setAdded(false);

    // Browsing is open to everyone; buying needs an account. Come back to this page after signing in.
    const { data } = await createClient().auth.getSession();
    if (!data.session) {
      router.push(`/auth/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }

    setBusy(true);
    try {
      await authedApi("/cart/items", { method: "POST", body: { variantId: variant.id, quantity: safeQty } });
      setAdded(true);
      notifyCartChanged();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? err.message // "Only 3 left in stock" / "This item is sold out"
          : err instanceof ApiError && err.message
            ? err.message
            : "We couldn't add that to your bag. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Quantity" className="inline-flex h-12 items-center rounded-md border border-input bg-card">
          <button
            type="button"
            aria-label="Decrease quantity"
            disabled={safeQty <= 1 || unavailable}
            onClick={() => setQty(safeQty - 1)}
            className="grid h-full w-11 place-items-center disabled:opacity-40"
          >
            <Minus aria-hidden className="size-4" />
          </button>
          <span aria-live="polite" className="w-8 text-center text-sm font-medium tabular-nums" data-testid="qty">
            {safeQty}
          </span>
          <button
            type="button"
            aria-label="Increase quantity"
            disabled={safeQty >= max || unavailable}
            onClick={() => setQty(safeQty + 1)}
            className="grid h-full w-11 place-items-center disabled:opacity-40"
          >
            <Plus aria-hidden className="size-4" />
          </button>
        </div>

        <Button type="button" className="h-12 flex-1 px-8 text-base" disabled={busy || unavailable} onClick={add}>
          <ShoppingBag aria-hidden />
          {unavailable ? "Sold out" : busy ? "Adding…" : "Add to bag"}
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {added && (
        <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Check aria-hidden className="size-4" /> Added to your bag
          </span>
          <Link href="/cart" className="font-medium underline underline-offset-4">
            View bag
          </Link>
          <Link href="/checkout" className="font-medium underline underline-offset-4">
            Checkout
          </Link>
          <span className="sr-only">{productName}</span>
        </p>
      )}
    </div>
  );
}
