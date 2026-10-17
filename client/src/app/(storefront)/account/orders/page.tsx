import type { Metadata } from "next";
import Link from "next/link";
import { Package } from "lucide-react";
import { Suspense } from "react";
import { Pagination } from "@/components/catalogue/pagination";
import { OrderStatusBadge, PaymentStatusText } from "@/components/orders/order-status";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/server-session";
import { formatINR } from "@/lib/utils";
import type { PageMeta } from "@/types/catalogue";
import type { OrderListItem } from "@/types/commerce";

export const metadata: Metadata = { title: "My orders", robots: { index: false } };

async function Body({ searchParams }: Pick<PageProps<"/account/orders">, "searchParams">) {
  const { token } = await requireSession("/account/orders");
  const sp = await searchParams;
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);
  const { data, meta } = await api<OrderListItem[]>("/orders", { token, query: { page, pageSize: 10 }, cache: "no-store" });
  const m = meta as unknown as PageMeta;

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card px-6 py-16 text-center">
        <Package aria-hidden className="mx-auto size-10 text-muted-foreground" />
        <h2 className="mt-4 text-3xl font-semibold">No orders yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">When you place an order, you can track it here.</p>
        <Button className="mt-6 h-11 px-6" nativeButton={false} render={<Link href="/shop" />}>
          Start shopping
        </Button>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-4">
        {data.map((o) => (
          <li key={o.id}>
            <Link href={`/account/orders/${o.id}`} className="block rounded-xl border bg-card p-5 transition-shadow hover:shadow-md" data-testid="order-row">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{o.orderNumber}</p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {o.itemCount} item{o.itemCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums">{formatINR(o.grandTotal)}</p>
                  <p className="text-xs text-muted-foreground">
                    <PaymentStatusText status={o.paymentStatus} method={o.paymentMethod} />
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="flex -space-x-2">
                  {o.preview.map((p, i) =>
                    p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={p.image} alt="" className="size-12 rounded-md border-2 border-card object-cover" />
                    ) : (
                      <span key={i} className="grid size-12 place-items-center rounded-md border-2 border-card bg-muted text-xs">·</span>
                    ),
                  )}
                </div>
                <OrderStatusBadge status={o.fulfilmentStatus} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <Pagination basePath="/account/orders" searchParams={sp} page={m.page} totalPages={m.totalPages} />
    </>
  );
}

export default function OrdersPage({ searchParams }: PageProps<"/account/orders">) {
  return (
    <>
      <h1 className="mb-6 text-4xl font-semibold text-primary">My orders</h1>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}
