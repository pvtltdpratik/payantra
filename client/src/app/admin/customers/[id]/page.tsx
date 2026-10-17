import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StatusBadge } from "@/components/admin/status-badge";
import { OrderStatusBadge, PaymentStatusText } from "@/components/orders/order-status";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import { formatINR } from "@/lib/utils";
import type { AdminCustomerDetail } from "@/types/analytics";
import type { FulfilmentStatus, PaymentStatus } from "@/types/commerce";

export const metadata: Metadata = { title: "Customer" };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }) : "—");

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

async function Body({ params }: Pick<PageProps<"/admin/customers/[id]">, "params">) {
  const { id } = await params;
  const { token } = await requireAdmin(`/admin/customers/${id}`);
  let c: AdminCustomerDetail;
  try {
    c = (await api<AdminCustomerDetail>(`/admin/customers/${encodeURIComponent(id)}`, { token, cache: "no-store" })).data;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold text-primary" data-testid="customer-name">
            {c.fullName ?? c.email}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {c.email} · {c.phone ? `+91 ${c.phone}` : "no phone"} · joined {day(c.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={c.status} label={c.status === "ACTIVE" ? "Active" : "Suspended"} />
          <Link href={`/admin/users?q=${encodeURIComponent(c.email)}`} className="text-sm text-primary hover:underline">
            Change role or status →
          </Link>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Customer figures">
        <Stat label="Orders" value={c.stats.orders} />
        <Stat label="Total paid" value={formatINR(c.stats.totalSpent)} />
        <Stat label="Net of refunds" value={formatINR(c.stats.netSpent)} />
        <Stat label="Average order" value={formatINR(c.stats.averageOrder)} />
      </dl>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="orders-h" className="space-y-3">
          <h2 id="orders-h" className="text-2xl font-semibold">
            Recent orders
          </h2>
          {c.recentOrders.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card text-sm">
              {c.recentOrders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    <Link href={`/admin/orders/${o.id}`} className="font-medium text-primary hover:underline">
                      {o.orderNumber}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {day(o.createdAt)} · <PaymentStatusText status={o.paymentStatus as PaymentStatus} method={o.paymentMethod} />
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">{formatINR(o.grandTotal)}</span>
                    <OrderStatusBadge status={o.fulfilmentStatus as FulfilmentStatus} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-8">
          <section aria-labelledby="addr-h">
            <h2 id="addr-h" className="mb-2 text-2xl font-semibold">
              Addresses
            </h2>
            {c.addresses.length === 0 ? (
              <p className="text-sm text-muted-foreground">None saved.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {c.addresses.map((a) => (
                  <li key={a.id} className="rounded-md border bg-card p-3">
                    <strong>{a.fullName}</strong> {a.isDefault && <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs">Default</span>}
                    <br />
                    <span className="text-muted-foreground">
                      {a.line1}, {a.city}, {a.state} {a.postalCode}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="sup-h">
            <h2 id="sup-h" className="mb-2 text-2xl font-semibold">
              Support
            </h2>
            {c.supportRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No requests.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {c.supportRequests.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2 rounded-md border bg-card px-3 py-2">
                    <Link href="/admin/support" className="truncate hover:text-primary">
                      {s.subject}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">{s.status.toLowerCase().replace("_", " ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-xs text-muted-foreground">
            {c.stats.wishlistItems} saved item{c.stats.wishlistItems === 1 ? "" : "s"} · {c.stats.reviews} review{c.stats.reviews === 1 ? "" : "s"} · last order {day(c.stats.lastOrderAt)}
          </p>
        </aside>
      </div>
    </div>
  );
}

export default function AdminCustomerPage({ params }: PageProps<"/admin/customers/[id]">) {
  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/admin/customers" className="text-sm text-muted-foreground hover:text-primary">
        ← Customers
      </Link>
      <div className="mt-3">
        <Suspense fallback={<Skeleton className="h-[32rem]" />}>
          <Body params={params} />
        </Suspense>
      </div>
    </div>
  );
}
