import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { StatusBadge } from "@/components/admin/status-badge";
import { Pagination } from "@/components/catalogue/pagination";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import { formatINR } from "@/lib/utils";
import type { PageMeta } from "@/types/catalogue";
import type { AdminProductRow } from "@/types/admin";

export const metadata: Metadata = { title: "Products" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Body({ searchParams }: Pick<PageProps<"/admin/products">, "searchParams">) {
  const { token } = await requireAdmin("/admin/products");
  const sp = await searchParams;
  const q = first(sp.q)?.trim() || undefined;
  const status = ["DRAFT", "ACTIVE", "ARCHIVED"].includes(first(sp.status) ?? "") ? first(sp.status) : undefined;
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const { data, meta } = await api<AdminProductRow[]>("/admin/products", {
    token,
    query: { q, status, page, pageSize: 20 },
    cache: "no-store",
  });
  const m = meta as unknown as PageMeta;

  return (
    <>
      <form method="get" className="mb-6 flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name or SKU"
          aria-label="Search products"
          className="h-10 w-full max-w-xs rounded-md border border-input bg-card px-3 text-sm"
        />
        <select name="status" defaultValue={status ?? ""} aria-label="Filter by status" className="h-10 rounded-md border border-input bg-card px-3 text-sm">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="DRAFT">Draft</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <Button type="submit" variant="outline" className="h-10">
          Filter
        </Button>
      </form>

      {data.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card p-10 text-center text-muted-foreground">
          No products match. {q || status ? "Try clearing the filters." : "Create your first product to get started."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">
                  <span className="sr-only">Image</span>
                </TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="size-12 rounded object-cover" />
                    ) : (
                      <span className="grid size-12 place-items-center rounded bg-muted text-[10px] text-muted-foreground">none</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`/admin/products/${p.id}`} className="font-medium text-primary hover:underline">
                      {p.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{p.variantCount} variant{p.variantCount === 1 ? "" : "s"}</p>
                  </TableCell>
                  <TableCell>{p.category}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatINR(p.effectivePrice)}
                    {p.salePrice !== null && <s className="ml-1 text-xs text-muted-foreground">{formatINR(p.basePrice)}</s>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.available === 0 ? <StatusBadge status="OUT" label="Sold out" /> : p.available}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination basePath="/admin/products" searchParams={sp} page={m.page} totalPages={m.totalPages} />
    </>
  );
}

export default function AdminProductsPage({ searchParams }: PageProps<"/admin/products">) {
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl font-semibold text-primary">Products</h1>
        <Button nativeButton={false} render={<Link href="/admin/products/new" />} className="h-10">
          <Plus aria-hidden /> New product
        </Button>
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}
