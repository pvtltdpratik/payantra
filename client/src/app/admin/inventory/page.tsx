import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdjustStock } from "@/components/admin/adjust-stock";
import { StatusBadge } from "@/components/admin/status-badge";
import { Pagination } from "@/components/catalogue/pagination";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import type { PageMeta } from "@/types/catalogue";
import type { InventoryRow } from "@/types/admin";

export const metadata: Metadata = { title: "Inventory" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Body({ searchParams }: Pick<PageProps<"/admin/inventory">, "searchParams">) {
  const { token } = await requireAdmin("/admin/inventory");
  const sp = await searchParams;
  const q = first(sp.q)?.trim() || undefined;
  const lowStock = first(sp.lowStock) === "true";
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const { data, meta } = await api<InventoryRow[]>("/admin/inventory", {
    token,
    query: { q, lowStock: lowStock ? "true" : undefined, page, pageSize: 25 },
    cache: "no-store",
  });
  const m = meta as unknown as PageMeta;

  return (
    <>
      <form method="get" className="mb-6 flex flex-wrap items-center gap-3">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search product or SKU"
          aria-label="Search inventory"
          className="h-10 w-full max-w-xs rounded-md border border-input bg-card px-3 text-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="lowStock" value="true" defaultChecked={lowStock} className="size-4 accent-[var(--primary)]" />
          Low stock only
        </label>
        <Button type="submit" variant="outline" className="h-10">
          Apply
        </Button>
      </form>

      {data.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card p-10 text-center text-muted-foreground">
          {lowStock ? "Nothing is running low. 🎉" : "No inventory matches your search."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Variant</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.variantId}>
                  <TableCell>
                    <Link href={`/admin/products/${r.productId}`} className="font-medium text-primary hover:underline">
                      {r.productName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell>{[r.size, r.colour].filter(Boolean).join(" / ") || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.onHand}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.reserved}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{r.available}</TableCell>
                  <TableCell>
                    {r.available === 0 ? (
                      <StatusBadge status="OUT" label="Out of stock" />
                    ) : r.isLow ? (
                      <StatusBadge status="LOW" label={`Low (≤ ${r.lowStockThreshold})`} />
                    ) : (
                      <StatusBadge status="OK" label="Healthy" />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <AdjustStock row={r} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination basePath="/admin/inventory" searchParams={sp} page={m.page} totalPages={m.totalPages} />
    </>
  );
}

export default function AdminInventoryPage({ searchParams }: PageProps<"/admin/inventory">) {
  return (
    <>
      <h1 className="mb-6 text-4xl font-semibold text-primary">Inventory</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}
