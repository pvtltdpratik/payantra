import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Pagination } from "@/components/catalogue/pagination";
import { OrderStatusBadge, PaymentStatusText } from "@/components/orders/order-status";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import { formatINR } from "@/lib/utils";
import type { AdminOrderRow } from "@/types/admin";
import type { PageMeta } from "@/types/catalogue";
import { STATUS_LABEL, type FulfilmentStatus } from "@/types/commerce";

export const metadata: Metadata = { title: "Orders" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STATUSES = Object.keys(STATUS_LABEL) as FulfilmentStatus[];

async function Body({ searchParams }: Pick<PageProps<"/admin/orders">, "searchParams">) {
  const { token } = await requireAdmin("/admin/orders");
  const sp = await searchParams;
  const q = first(sp.q)?.trim() || undefined;
  const status = STATUSES.includes(first(sp.status) as FulfilmentStatus) ? first(sp.status) : undefined;
  const paymentStatus = first(sp.paymentStatus) || undefined;
  const paymentMethod = first(sp.paymentMethod) || undefined;
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const { data, meta } = await api<AdminOrderRow[]>("/admin/orders", {
    token,
    query: { q, status, paymentStatus, paymentMethod, page, pageSize: 20 },
    cache: "no-store",
  });
  const m = meta as unknown as PageMeta;
  const select = "h-10 rounded-md border border-input bg-card px-3 text-sm";

  return (
    <>
      <form method="get" className="mb-6 flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Order no., email, name or phone" aria-label="Search orders" className="h-10 w-full max-w-xs rounded-md border border-input bg-card px-3 text-sm" />
        <select name="status" defaultValue={status ?? ""} aria-label="Fulfilment status" className={select}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select name="paymentStatus" defaultValue={paymentStatus ?? ""} aria-label="Payment status" className={select}>
          <option value="">Any payment</option>
          {["PENDING", "CAPTURED", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED"].map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
        <select name="paymentMethod" defaultValue={paymentMethod ?? ""} aria-label="Payment method" className={select}>
          <option value="">Online + COD</option>
          <option value="RAZORPAY">Online</option>
          <option value="COD">Cash on delivery</option>
        </select>
        <Button type="submit" variant="outline" className="h-10">
          Filter
        </Button>
      </form>

      {data.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card p-10 text-center text-muted-foreground">No orders match.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Placed</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((o) => (
                <TableRow key={o.id} data-testid="admin-order-row">
                  <TableCell>
                    <Link href={`/admin/orders/${o.id}`} className="font-medium text-primary hover:underline">
                      {o.orderNumber}
                    </Link>
                    <p className="text-xs text-muted-foreground">{o.itemCount} item{o.itemCount === 1 ? "" : "s"}</p>
                  </TableCell>
                  <TableCell>
                    {o.shipFullName}
                    <p className="text-xs text-muted-foreground">{o.customerEmail}</p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(o.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(o.grandTotal)}</TableCell>
                  <TableCell className="text-sm">
                    <PaymentStatusText status={o.paymentStatus} method={o.paymentMethod} />
                  </TableCell>
                  <TableCell>
                    <OrderStatusBadge status={o.fulfilmentStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination basePath="/admin/orders" searchParams={sp} page={m.page} totalPages={m.totalPages} />
    </>
  );
}

export default function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  return (
    <>
      <h1 className="mb-6 text-4xl font-semibold text-primary">Orders</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}
