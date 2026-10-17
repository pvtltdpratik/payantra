"use client";

import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Banknote, CreditCard, Lock, MapPin } from "lucide-react";
import { AddressForm } from "@/components/account/address-form";
import { describeError } from "@/components/admin/api-error-message";
import { OrderSummary } from "@/components/cart/order-summary";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { notifyCartChanged } from "@/lib/cart-events";
import { authedApi } from "@/lib/client-api";
import { openRazorpayCheckout, RAZORPAY_SCRIPT, type RazorpayResponse } from "@/lib/razorpay";
import { cn, formatINR } from "@/lib/utils";
import type { Address, CartView, CheckoutOptions, CheckoutResult, PaymentMethod, RazorpayCheckoutParams } from "@/types/commerce";

type Phase =
  | { name: "form" }
  | { name: "working"; label: string }
  /** The Razorpay window closed or the payment failed. The order exists and its stock is held. */
  | { name: "unpaid"; orderId: string; message: string };

export function CheckoutForm({
  cart,
  initialAddresses,
  options,
}: {
  cart: CartView;
  initialAddresses: Address[];
  options: CheckoutOptions;
}) {
  const router = useRouter();
  const [addresses, setAddresses] = useState(initialAddresses);
  const [addressId, setAddressId] = useState(initialAddresses.find((a) => a.isDefault)?.id ?? initialAddresses[0]?.id ?? "");
  const [adding, setAdding] = useState(initialAddresses.length === 0);
  const [method, setMethod] = useState<PaymentMethod>("RAZORPAY");
  const [phase, setPhase] = useState<Phase>({ name: "form" });
  const [error, setError] = useState<string | null>(null);
  const [scriptReady, setScriptReady] = useState(typeof window !== "undefined" && !!window.Razorpay);
  const [scriptFailed, setScriptFailed] = useState(false);

  // One key per checkout attempt. Re-sending the SAME key (after a timeout or a double click) can never
  // create a second order; it is replaced only when the previous attempt definitely did not create one.
  const keyRef = useRef<string | null>(null);

  const codAllowed = options.codEnabled && cart.pricing.grandTotal <= options.codMaxOrder;
  const working = phase.name === "working";

  const goToOrder = (orderId: string) => {
    notifyCartChanged();
    router.push(`/account/orders/${orderId}?placed=1`);
    router.refresh();
  };

  async function verify(orderId: string, r: RazorpayResponse) {
    setPhase({ name: "working", label: "Confirming your payment…" });
    try {
      const res = await authedApi<{ status: "PAID" | "PENDING" | "FAILED" }>("/payments/verify", { method: "POST", body: r });
      if (res.data.status === "PAID") return goToOrder(orderId);
      setPhase({
        name: "unpaid",
        orderId,
        message: res.data.status === "FAILED" ? "Your payment did not go through." : "We're still waiting for the bank to confirm your payment.",
      });
    } catch (err) {
      // The money may have moved even though we couldn't confirm it just now; the webhook and the
      // order page will settle it, so send the shopper there rather than inviting a second payment.
      setPhase({
        name: "unpaid",
        orderId,
        message:
          err instanceof ApiError && err.status >= 400 && err.status < 500
            ? describeError(err)
            : "We couldn't confirm your payment just yet. If money was deducted, your order will be confirmed automatically.",
      });
    }
  }

  function openRazorpay(orderId: string, p: RazorpayCheckoutParams) {
    setPhase({ name: "working", label: "Waiting for payment…" });
    const opened = openRazorpayCheckout(p, {
      onPaid: (r) => void verify(orderId, r),
      onDismiss: () => setPhase({ name: "unpaid", orderId, message: "You closed the payment window before paying." }),
      onFailed: (message) => setPhase({ name: "unpaid", orderId, message }),
    });
    if (!opened) {
      setPhase({ name: "unpaid", orderId, message: "The payment window could not be loaded. Check your connection and try again." });
    }
  }

  async function placeOrder() {
    if (!addressId || working) return;
    setError(null);
    keyRef.current ??= crypto.randomUUID().replace(/-/g, "");
    setPhase({ name: "working", label: method === "COD" ? "Placing your order…" : "Preparing secure payment…" });
    try {
      const { data } = await authedApi<CheckoutResult>("/checkout", {
        method: "POST",
        body: { addressId, paymentMethod: method, idempotencyKey: keyRef.current },
      });
      if (data.payment) openRazorpay(data.order.id, data.payment);
      else goToOrder(data.order.id);
    } catch (err) {
      setPhase({ name: "form" });
      const retryable = !(err instanceof ApiError) || err.status === 0 || err.status >= 500;
      // A definite "no" means no order exists, so the next attempt must be a fresh one; an ambiguous
      // failure keeps the key so a retry can never duplicate the order.
      if (!retryable) keyRef.current = null;
      if (err instanceof ApiError && err.status === 409 && Array.isArray(err.details)) {
        setError("Some items in your bag changed. Please review your bag before paying.");
        router.refresh();
      } else {
        setError(describeError(err, "We couldn't place your order. Please try again."));
      }
    }
  }

  async function retryPayment(orderId: string) {
    setPhase({ name: "working", label: "Re-opening payment…" });
    try {
      const { data } = await authedApi<{ status: "PAID" | "PENDING"; payment: RazorpayCheckoutParams | null }>(`/payments/${orderId}/retry`, { method: "POST" });
      if (data.status === "PAID" || !data.payment) return goToOrder(orderId);
      openRazorpay(orderId, data.payment);
    } catch (err) {
      setPhase({ name: "unpaid", orderId, message: describeError(err, "We couldn't restart the payment.") });
    }
  }

  if (phase.name === "unpaid") {
    return (
      <div role="alert" className="mx-auto max-w-lg rounded-xl border bg-card p-8 text-center">
        <h2 className="text-3xl font-semibold">Payment not completed</h2>
        <p className="mt-3 text-muted-foreground">{phase.message}</p>
        <p className="mt-2 text-sm text-muted-foreground">Your items are reserved for a few minutes so you can try again.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button className="h-11 px-6" onClick={() => retryPayment(phase.orderId)}>
            Try payment again
          </Button>
          <Button variant="outline" className="h-11" nativeButton={false} render={<Link href={`/account/orders/${phase.orderId}`} />}>
            View order
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Script src={RAZORPAY_SCRIPT} strategy="afterInteractive" onLoad={() => setScriptReady(true)} onError={() => setScriptFailed(true)} />

      <div className="grid gap-10 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-8">
          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <section aria-labelledby="addr-h" className="rounded-xl border bg-card p-5 sm:p-6">
            <h2 id="addr-h" className="flex items-center gap-2 text-2xl font-semibold">
              <MapPin aria-hidden className="size-5 text-primary" /> Delivery address
            </h2>

            {addresses.length > 0 && (
              <fieldset className="mt-4 space-y-3">
                <legend className="sr-only">Choose a delivery address</legend>
                {addresses.map((a) => (
                  <label
                    key={a.id}
                    className={cn("flex cursor-pointer gap-3 rounded-lg border p-4 has-[:focus-visible]:outline-2", addressId === a.id ? "border-primary bg-primary/5" : "hover:border-foreground/30")}
                  >
                    <input type="radio" name="address" value={a.id} checked={addressId === a.id} onChange={() => setAddressId(a.id)} className="mt-1 accent-[var(--primary)]" />
                    <span className="text-sm">
                      <span className="block font-semibold">
                        {a.fullName} {a.isDefault && <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal">Default</span>}
                      </span>
                      <span className="block text-muted-foreground">
                        {[a.line1, a.line2, a.landmark].filter(Boolean).join(", ")}, {a.city}, {a.state} {a.postalCode} · +91 {a.phone}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            {adding ? (
              <div className="mt-5 border-t pt-5">
                <AddressForm
                  idPrefix="co"
                  forceDefault={addresses.length === 0}
                  onSaved={(a) => {
                    setAddresses((prev) => [a, ...prev.map((x) => (a.isDefault ? { ...x, isDefault: false } : x))]);
                    setAddressId(a.id);
                    setAdding(false);
                  }}
                  onCancel={addresses.length > 0 ? () => setAdding(false) : undefined}
                />
              </div>
            ) : (
              <Button variant="outline" className="mt-4 h-10" onClick={() => setAdding(true)}>
                Add a new address
              </Button>
            )}
          </section>

          <section aria-labelledby="pay-h" className="rounded-xl border bg-card p-5 sm:p-6">
            <h2 id="pay-h" className="flex items-center gap-2 text-2xl font-semibold">
              <CreditCard aria-hidden className="size-5 text-primary" /> Payment
            </h2>
            <fieldset className="mt-4 space-y-3">
              <legend className="sr-only">Payment method</legend>
              <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-4", method === "RAZORPAY" ? "border-primary bg-primary/5" : "hover:border-foreground/30")}>
                <input type="radio" name="method" checked={method === "RAZORPAY"} onChange={() => setMethod("RAZORPAY")} className="mt-1 accent-[var(--primary)]" />
                <span className="text-sm">
                  <span className="block font-semibold">Pay online</span>
                  <span className="text-muted-foreground">UPI, cards, net banking and wallets — secured by Razorpay.</span>
                </span>
              </label>
              {options.codEnabled && (
                <label className={cn("flex items-start gap-3 rounded-lg border p-4", codAllowed ? "cursor-pointer" : "opacity-60", method === "COD" ? "border-primary bg-primary/5" : "hover:border-foreground/30")}>
                  <input type="radio" name="method" disabled={!codAllowed} checked={method === "COD"} onChange={() => setMethod("COD")} className="mt-1 accent-[var(--primary)]" />
                  <span className="text-sm">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Banknote aria-hidden className="size-4" /> Cash on Delivery
                    </span>
                    <span className="text-muted-foreground">
                      {codAllowed ? "Pay in cash when your order arrives." : `Available for orders up to ${formatINR(options.codMaxOrder)}. Please pay online.`}
                    </span>
                  </span>
                </label>
              )}
            </fieldset>
            {method === "RAZORPAY" && scriptFailed && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                The secure payment window couldn&apos;t load. Check your connection or ad-blocker and reload the page.
              </p>
            )}
          </section>
        </div>

        <aside aria-label="Order summary" className="h-fit space-y-5 rounded-xl border bg-card p-5 lg:sticky lg:top-24">
          <h2 className="text-2xl font-semibold">Order summary</h2>
          <ul className="divide-y text-sm" aria-label="Items">
            {cart.items.map((i) => (
              <li key={i.variantId} className="flex justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="line-clamp-1 font-medium">{i.name}</span>
                  <span className="text-muted-foreground">
                    {[i.colour, i.size && `Size ${i.size}`].filter(Boolean).join(" · ")} × {i.quantity}
                  </span>
                </span>
                <span className="tabular-nums">{formatINR(i.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <OrderSummary pricing={cart.pricing} />

          <Button
            className="h-12 w-full text-base"
            disabled={!addressId || working || (method === "RAZORPAY" && !scriptReady && !scriptFailed)}
            onClick={placeOrder}
          >
            <Lock aria-hidden />
            {working ? phase.label : method === "COD" ? `Place order · ${formatINR(cart.pricing.grandTotal)}` : `Pay ${formatINR(cart.pricing.grandTotal)}`}
          </Button>
          {!addressId && <p className="text-center text-xs text-muted-foreground">Add a delivery address to continue.</p>}
          <p className="text-center text-xs text-muted-foreground">
            The amount you pay is calculated securely on our servers.
          </p>
        </aside>
      </div>
    </>
  );
}
