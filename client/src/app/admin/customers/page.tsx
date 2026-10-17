import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StatusBadge } from "@/components/admin/status-badge";
import { Pagination } from "@/components/catalogue/pagination";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import { formatINR } from "@/lib/utils";
import type { PageMeta } from "@/types/catalogue";
import type { AdminCustomerRow } from "@/types/analytics";

export const metadata: Metadata = { title: "Customers" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Body({ searchParams }: Pick<PageProps<"/admin/customers">, "searchParams">) {
  const { token } = await requireAdmin("/admin/customers");
  const sp = await searchParams;
  const q = first(sp.q)?.trim() || undefined;
  const status = first(sp.status) === "ACTIVE" || first(sp.status) === "SUSPENDED" ? first(sp.status) : undefined;
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const { data, meta } = await api<AdminCustomerRow[]>("/admin/customers", { token, cache: "no-store", query: { q, status, page, pageSize: 20 } });
  const m = meta as unknown as PageMeta;

  return (
    <>
      <form method="get" className="mb-6 flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Name, email or phone" aria-label="Search customers" className="h-10 w-full max-w-xs rounded-md border border-input bg-card px-3 text-sm" />
        <select name="status" defaultValue={status ?? ""} aria-label="Account status" className="h-10 rounded-md border border-input bg-card px-3 text-sm">
          <option value="">All accounts</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
        <Button type="submit" variant="outline" className="h-10">
          Filter
        </Button>
      </form>

      {data.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card p-10 text-center text-muted-foreground">No customers match.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Spent</TableHead>
                <TableHead>Last order</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((c) => (
                <TableRow key={c.id} data-testid="customer-row">
                  <TableCell>
                    <Link href={`/admin/customers/${c.id}`} className="font-medium text-primary hover:underline">
                      {c.fullName ?? c.email}
                    </Link>
                    <p className="text-xs text-muted-foreground">{c.fullName ? c.email : (c.phone ?? "")}</p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} label={c.status === "ACTIVE" ? "Active" : "Suspended"} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.orders}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(c.totalSpent)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }) : "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(c.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination basePath="/admin/customers" searchParams={sp} page={m.page} totalPages={m.totalPages} />
    </>
  );
}

export default function AdminCustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-4xl font-semibold text-primary">Customers</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
