import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OrderAdminActions } from "@/components/admin/order-admin-actions";
import { OrderStatusBadge, OrderTimeline, PaymentStatusText } from "@/components/orders/order-status";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import { formatINR } from "@/lib/utils";
import type { AdminOrderView } from "@/types/admin";

export const metadata: Metadata = { title: "Order" };

async function Body({ params }: Pick<PageProps<"/admin/orders/[id]">, "params">) {
  const { id } = await params;
  const { token } = await requireAdmin(`/admin/orders/${id}`);
  let o: AdminOrderView;
  try {
    o = (await api<AdminOrderView>(`/admin/orders/${encodeURIComponent(id)}`, { token, cache: "no-store" })).data;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold text-primary">{o.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {new Date(o.createdAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" })} · {o.paymentMethod === "COD" ? "Cash on delivery" : "Online payment"}
          </p>
        </div>
        <div className="text-right">
          <OrderStatusBadge status={o.fulfilmentStatus} />
          <p className="mt-1 text-sm text-muted-foreground" data-testid="admin-payment-status">
            <PaymentStatusText status={o.paymentStatus} method={o.paymentMethod} />
          </p>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          <OrderAdminActions order={o} />

          <section aria-labelledby="items-h">
            <h2 id="items-h" className="mb-3 text-2xl font-semibold">
              Items
            </h2>
            <ul className="divide-y rounded-xl border bg-card">
              {o.items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="font-medium">{i.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {i.sku} · {[i.colour, i.size && `Size ${i.size}`].filter(Boolean).join(" · ")} · {formatINR(i.unitPrice)} × {i.quantity}
                    </p>
                  </div>
                  <p className="tabular-nums">{formatINR(i.lineTotal)}</p>
                </li>
              ))}
            </ul>
            <dl className="ml-auto mt-3 max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{formatINR(o.subtotal)}</dd></div>
              {o.discountTotal > 0 && <div className="flex justify-between text-success"><dt>Coupon {o.couponCode && `(${o.couponCode})`}</dt><dd className="tabular-nums">−{formatINR(o.discountTotal)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted-foreground">Delivery</dt><dd className="tabular-nums">{o.shippingTotal ? formatINR(o.shippingTotal) : "Free"}</dd></div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatINR(o.grandTotal)}</dd></div>
              {o.payment && o.payment.refundedAmount > 0 && <div className="flex justify-between text-success"><dt>Refunded</dt><dd className="tabular-nums">{formatINR(o.payment.refundedAmount)}</dd></div>}
            </dl>
          </section>

          {o.refunds.length > 0 && (
            <section aria-labelledby="ref-h">
              <h2 id="ref-h" className="mb-3 text-2xl font-semibold">
                Refunds
              </h2>
              <ul className="space-y-2 text-sm">
                {o.refunds.map((r) => (
                  <li key={r.id} className="flex flex-wrap justify-between gap-2 rounded-md border bg-card px-3 py-2" data-testid="admin-refund">
                    <span>
                      {r.status.toLowerCase()} · {r.reason ?? "—"}
                    </span>
                    <span className="tabular-nums">{formatINR(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-8">
          <section aria-labelledby="cust-h">
            <h2 id="cust-h" className="mb-2 text-2xl font-semibold">
              Customer
            </h2>
            <p className="text-sm">
              <strong>{o.customer.fullName ?? o.address.fullName}</strong>
              <br />
              <Link href={`/admin/users?q=${encodeURIComponent(o.customer.email)}`} className="text-primary hover:underline">
                {o.customer.email}
              </Link>
            </p>
            <address className="mt-3 text-sm not-italic text-muted-foreground">
              {o.address.fullName}
              <br />
              {[o.address.line1, o.address.line2, o.address.landmark].filter(Boolean).join(", ")}
              <br />
              {o.address.city}, {o.address.state} {o.address.postalCode}
              <br />
              +91 {o.address.phone}
            </address>
          </section>
          <section aria-labelledby="tl-h">
            <h2 id="tl-h" className="mb-4 text-2xl font-semibold">
              Timeline
            </h2>
            <OrderTimeline order={o} />
          </section>
        </aside>
      </div>
    </div>
  );
}

export default function AdminOrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/admin/orders" className="text-sm text-muted-foreground hover:text-primary">
        ← Orders
      </Link>
      <div className="mt-3">
        <Suspense fallback={<Skeleton className="h-[32rem]" />}>
          <Body params={params} />
        </Suspense>
      </div>
    </div>
  );
}
