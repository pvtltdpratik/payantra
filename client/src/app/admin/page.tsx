import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { DateRangeForm } from "@/components/admin/date-range-form";
import { BarChart } from "@/components/charts/bar-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { istDateKey, rangeFromParams, shortDate } from "@/lib/ist";
import { requireAdmin } from "@/lib/server-session";
import { cn, formatINR } from "@/lib/utils";
import { STATUS_LABEL, type FulfilmentStatus } from "@/types/commerce";
import type { Overview } from "@/types/analytics";

export const metadata: Metadata = { title: "Overview" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Change versus the previous period of the same length. `good` says which direction is good news. */
function Delta({ now, before, label, goodWhen = "up" }: { now: number; before: number; label: string; goodWhen?: "up" | "down" }) {
  if (before === 0 && now === 0) return <span className="text-xs text-muted-foreground">No change vs {label}</span>;
  if (before === 0) return <span className="text-xs text-muted-foreground">New vs {label}</span>;
  const pct = ((now - before) / before) * 100;
  if (Math.abs(pct) < 0.05) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Minus aria-hidden className="size-3" /> Flat vs {label}</span>;
  const up = pct > 0;
  const good = up === (goodWhen === "up");
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", good ? "text-success" : "text-destructive")}>
      <Icon aria-hidden className="size-3.5" />
      {Math.abs(pct).toFixed(1)}% <span className="font-normal text-muted-foreground">vs {label}</span>
    </span>
  );
}

function Kpi({ label, value, children, testId }: { label: string; value: React.ReactNode; children?: React.ReactNode; testId?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl" data-testid={testId}>
        {value}
      </dd>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

function Attention({ href, count, label }: { href: string; count: number; label: string }) {
  return (
    <li>
      <Link href={href} className={cn("flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm hover:border-primary/40", count > 0 ? "bg-warning/5" : "bg-card text-muted-foreground")}>
        <span>{label}</span>
        <span className={cn("rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums", count > 0 ? "bg-warning/20 text-foreground" : "bg-muted")}>{count}</span>
      </Link>
    </li>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/admin">, "searchParams">) {
  const { token } = await requireAdmin("/admin");
  const sp = await searchParams;
  const today = istDateKey(new Date());
  const range = rangeFromParams(first(sp.from), first(sp.to), new Date());
  const { data: o } = await api<Overview>("/admin/analytics/overview", { token, cache: "no-store", query: range });

  const prevLabel = `previous ${o.range.days} day${o.range.days === 1 ? "" : "s"}`;
  const t = o.totals;
  const p = o.previous.totals;

  return (
    <div className="space-y-10">
      <DateRangeForm basePath="/admin" from={range.from} to={range.to} today={today} />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Key figures">
        <Kpi label="Net revenue" value={formatINR(t.netRevenue)} testId="kpi-net">
          <Delta now={t.netRevenue} before={p.netRevenue} label={prevLabel} />
        </Kpi>
        <Kpi label="Gross sales" value={formatINR(t.grossSales)} testId="kpi-gross">
          <Delta now={t.grossSales} before={p.grossSales} label={prevLabel} />
        </Kpi>
        <Kpi label="Paid orders" value={t.paidOrders.toLocaleString("en-IN")} testId="kpi-orders">
          <Delta now={t.paidOrders} before={p.paidOrders} label={prevLabel} />
        </Kpi>
        <Kpi label="Average order" value={formatINR(t.averageOrderValue)}>
          <Delta now={t.averageOrderValue} before={p.averageOrderValue} label={prevLabel} />
        </Kpi>
        <Kpi label="Refunds" value={formatINR(t.refunds)}>
          <Delta now={t.refunds} before={p.refunds} label={prevLabel} goodWhen="down" />
        </Kpi>
        <Kpi label="Customers" value={o.customers.total.toLocaleString("en-IN")}>
          <span className="text-xs text-muted-foreground">+{o.customers.new} new in this period</span>
        </Kpi>
        <Kpi label="Delivery partners" value={`${o.partners.online} online`}>
          <span className="text-xs text-muted-foreground">{o.partners.approved} active · {o.partners.pendingApplications} waiting for approval</span>
        </Kpi>
        <Kpi label="Orders placed" value={o.ordersPlaced.toLocaleString("en-IN")}>
          <span className="text-xs text-muted-foreground">in this period, any status</span>
        </Kpi>
      </dl>

      <section aria-labelledby="sales-h" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="sales-h" className="text-2xl font-semibold">
            Sales by day
          </h2>
          <Link href={`/admin/analytics?report=sales&from=${range.from}&to=${range.to}`} className="text-sm text-primary hover:underline">
            Full sales report →
          </Link>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <BarChart
            title={`Gross sales per day, ${shortDate(o.range.from)} to ${shortDate(o.range.to)}`}
            labels={o.salesByDay.map((d) => shortDate(d.date))}
            series={[
              { name: "Gross sales", color: "var(--primary)" },
              { name: "Refunds", color: "var(--destructive)" },
            ]}
            values={[o.salesByDay.map((d) => d.gross), o.salesByDay.map((d) => d.refunds)]}
            formatValue={(n) => formatINR(n)}
            height={220}
          />
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="attn-h" className="space-y-3">
          <h2 id="attn-h" className="text-2xl font-semibold">
            Needs attention
          </h2>
          <ul className="space-y-2">
            <Attention href="/admin/returns" count={o.pending.returnRequests + o.pending.returnsAwaitingCompletion} label="Return requests to decide or complete" />
            <Attention href="/admin/orders" count={o.pending.refundsAwaitingConfirmation} label="Refunds awaiting confirmation" />
            <Attention href="/admin/support" count={o.pending.supportRequests} label="Open support requests" />
            <Attention href="/admin/delivery-partners?status=PENDING" count={o.partners.pendingApplications} label="Delivery partner applications" />
            <Attention href="/admin/inventory?lowStock=true" count={o.lowStock.count} label="Products at or below their stock alert" />
          </ul>
        </section>

        <section aria-labelledby="status-h" className="space-y-3">
          <h2 id="status-h" className="text-2xl font-semibold">
            Orders by status
          </h2>
          {o.ordersPlaced === 0 ? (
            <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">No orders were placed in this period.</p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card text-sm" data-testid="status-breakdown">
              {Object.entries(o.orderStatus)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <li key={status} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <Link href={`/admin/orders?status=${status}`} className="hover:text-primary">
                      {STATUS_LABEL[status as FulfilmentStatus] ?? status}
                    </Link>
                    <span className="flex items-center gap-3">
                      <span className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
                        <span className="block h-full bg-primary" style={{ width: `${Math.max(4, (count / o.ordersPlaced) * 100)}%` }} />
                      </span>
                      <span className="w-8 text-right tabular-nums">{count}</span>
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="low-h" className="space-y-3">
          <h2 id="low-h" className="text-2xl font-semibold">
            Low stock
          </h2>
          {o.lowStock.items.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">Everything is above its stock alert.</p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card text-sm">
              {o.lowStock.items.map((i) => (
                <li key={i.variantId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <Link href={`/admin/products/${i.productId}`} className="block truncate font-medium hover:text-primary">
                      {i.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">{[i.colour, i.size, i.sku].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", i.available <= 0 ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>
                    {i.available <= 0 ? "Sold out" : `${i.available} left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="tx-h" className="space-y-3">
          <h2 id="tx-h" className="text-2xl font-semibold">
            Recent transactions
          </h2>
          {o.recentTransactions.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card text-sm" data-testid="recent-transactions">
              {o.recentTransactions.map((x) => (
                <li key={`${x.type}-${x.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <Link href={`/admin/orders/${x.orderId}`} className="font-medium hover:text-primary">
                      {x.orderNumber}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {x.type === "REFUND" ? "Refund" : "Payment"} · {new Date(x.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}
                    </span>
                  </span>
                  <span className={cn("tabular-nums font-medium", x.amount < 0 && "text-destructive")}>{x.amount < 0 ? "−" : ""}{formatINR(Math.abs(x.amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="text-xs text-muted-foreground">
        Sales are counted on the day a payment was received (Cash on Delivery: the day it was delivered), in India time. Net revenue is gross sales minus refunds processed in the period.
      </p>
    </div>
  );
}

export default function AdminOverviewPage({ searchParams }: PageProps<"/admin">) {
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-4xl font-semibold text-primary">Overview</h1>
      <Suspense fallback={<Skeleton className="h-[40rem]" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
