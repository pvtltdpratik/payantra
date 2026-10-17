import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/orders/auto-refresh";
import { DeliveryCard } from "@/components/orders/delivery-card";
import { OrderActions } from "@/components/orders/order-actions";
import { OrderStatusBadge, OrderTimeline, PaymentStatusText } from "@/components/orders/order-status";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { requireSession } from "@/lib/server-session";
import { formatINR } from "@/lib/utils";
import type { OrderView } from "@/types/commerce";

export const metadata: Metadata = { title: "Order details", robots: { index: false } };

async function Body({ params, searchParams }: Pick<PageProps<"/account/orders/[id]">, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  const { token } = await requireSession(`/account/orders/${id}`);

  let o: OrderView;
  try {
    o = (await api<OrderView>(`/orders/${encodeURIComponent(id)}`, { token, cache: "no-store" })).data;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }
  const justPlaced = sp.placed === "1" && o.fulfilmentStatus !== "CANCELLED";

  return (
    <div className="space-y-8">
      <Link href="/account/orders" className="text-sm text-muted-foreground hover:text-primary">
        ← All orders
      </Link>

      {justPlaced && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/5 p-5" data-testid="order-placed-banner">
          <CheckCircle2 aria-hidden className="mt-0.5 size-6 shrink-0 text-success" />
          <div>
            <h2 className="text-2xl font-semibold text-success">
              {o.paymentStatus === "CAPTURED" ? "Thank you — your order is confirmed" : o.paymentMethod === "COD" ? "Thank you — your order is placed" : "Order received"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {o.paymentStatus === "CAPTURED"
                ? "We've received your payment and are getting your order ready."
                : o.paymentMethod === "COD"
                  ? "Keep the exact amount handy; you'll pay when it arrives."
                  : "We're waiting for your payment to be confirmed. This page will update."}
            </p>
          </div>
        </div>
      )}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold text-primary">{o.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Placed {new Date(o.createdAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" })}
          </p>
        </div>
        <div className="text-right">
          <OrderStatusBadge status={o.fulfilmentStatus} />
          <p className="mt-1 text-sm text-muted-foreground" data-testid="payment-status">
            <PaymentStatusText status={o.paymentStatus} method={o.paymentMethod} />
          </p>
        </div>
      </header>

      {o.cancelReason && o.fulfilmentStatus === "CANCELLED" && (
        <p className="rounded-md border bg-muted px-4 py-3 text-sm">
          <strong>Cancelled:</strong> {o.cancelReason}
        </p>
      )}

      <OrderActions order={o} />

      <AutoRefresh active={["SHIPPED", "OUT_FOR_DELIVERY"].includes(o.fulfilmentStatus)} />
      <DeliveryCard delivery={o.delivery} />

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="items-h" className="space-y-4">
          <h2 id="items-h" className="text-2xl font-semibold">
            Items
          </h2>
          <ul className="divide-y rounded-xl border bg-card">
            {o.items.map((i) => (
              <li key={i.id} className="flex gap-4 p-4" data-testid="order-item">
                {i.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.image} alt="" className="size-20 shrink-0 rounded-md object-cover" />
                ) : (
                  <span className="size-20 shrink-0 rounded-md bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-lg font-semibold leading-snug">{i.name}</p>
                  <p className="text-sm text-muted-foreground">{[i.colour, i.size && `Size ${i.size}`].filter(Boolean).join(" · ")}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatINR(i.unitPrice)} × {i.quantity}
                  </p>
                </div>
                <p className="font-medium tabular-nums">{formatINR(i.lineTotal)}</p>
              </li>
            ))}
          </ul>

          <dl className="ml-auto max-w-xs space-y-1 text-sm" data-testid="order-totals">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums">{formatINR(o.subtotal)}</dd>
            </div>
            {o.discountTotal > 0 && (
              <div className="flex justify-between text-success">
                <dt>Coupon {o.couponCode && `(${o.couponCode})`}</dt>
                <dd className="tabular-nums">−{formatINR(o.discountTotal)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Delivery</dt>
              <dd className="tabular-nums">{o.shippingTotal ? formatINR(o.shippingTotal) : "Free"}</dd>
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatINR(o.grandTotal)}</dd>
            </div>
            {o.payment && o.payment.refundedAmount > 0 && (
              <div className="flex justify-between text-success">
                <dt>Refunded</dt>
                <dd className="tabular-nums">{formatINR(o.payment.refundedAmount)}</dd>
              </div>
            )}
          </dl>

          {o.returns.length > 0 && (
            <section aria-labelledby="ret-h" className="space-y-2">
              <h2 id="ret-h" className="text-2xl font-semibold">
                Returns
              </h2>
              <ul className="space-y-2 text-sm">
                {o.returns.map((r) => (
                  <li key={r.id} className="rounded-lg border bg-card p-4">
                    <p className="font-medium">
                      {r.type === "RETURN" ? "Return" : "Replacement"} · {r.status.toLowerCase()}
                    </p>
                    <p className="text-muted-foreground">{r.reason}</p>
                    {r.adminNote && <p className="mt-1">Our note: {r.adminNote}</p>}
                    {r.refundAmount ? <p className="mt-1 text-success">Refund: {formatINR(r.refundAmount)}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>

        <aside className="space-y-8">
          <section aria-labelledby="track-h">
            <h2 id="track-h" className="mb-4 text-2xl font-semibold">
              Tracking
            </h2>
            <OrderTimeline order={o} />
          </section>

          <section aria-labelledby="ship-h">
            <h2 id="ship-h" className="mb-2 text-2xl font-semibold">
              Delivery address
            </h2>
            <address className="text-sm not-italic text-muted-foreground">
              <strong className="text-foreground">{o.address.fullName}</strong>
              <br />
              {[o.address.line1, o.address.line2, o.address.landmark].filter(Boolean).join(", ")}
              <br />
              {o.address.city}, {o.address.state} {o.address.postalCode}
              <br />
              +91 {o.address.phone}
            </address>
          </section>

          {o.refunds.length > 0 && (
            <section aria-labelledby="ref-h">
              <h2 id="ref-h" className="mb-2 text-2xl font-semibold">
                Refunds
              </h2>
              <ul className="space-y-2 text-sm">
                {o.refunds.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2 rounded-md border bg-card px-3 py-2">
                    <span>{r.status === "PROCESSED" ? "Refunded" : r.status === "FAILED" ? "Refund failed" : "Refund in progress"}</span>
                    <span className="tabular-nums">{formatINR(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function OrderPage(props: PageProps<"/account/orders/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[32rem]" />}>
      <Body params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
