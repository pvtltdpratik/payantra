import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Pagination } from "@/components/catalogue/pagination";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PartnerStatusBadge } from "@/components/admin/partner-status-badge";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import type { PageMeta } from "@/types/catalogue";
import type { AdminPartnerRow } from "@/types/delivery";

export const metadata: Metadata = { title: "Delivery partners" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as const;

async function Body({ searchParams }: Pick<PageProps<"/admin/delivery-partners">, "searchParams">) {
  const { token } = await requireAdmin("/admin/delivery-partners");
  const sp = await searchParams;
  const q = first(sp.q)?.trim() || undefined;
  const status = STATUSES.find((s) => s === first(sp.status));
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const { data, meta } = await api<AdminPartnerRow[]>("/admin/delivery-partners", { token, cache: "no-store", query: { q, status, page, pageSize: 20 } });
  const m = meta as unknown as PageMeta;
  const select = "h-10 rounded-md border border-input bg-card px-3 text-sm";

  return (
    <>
      <form method="get" className="mb-6 flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Name, email, phone or city" aria-label="Search partners" className="h-10 w-full max-w-xs rounded-md border border-input bg-card px-3 text-sm" />
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className={select}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" className="h-10">
          Filter
        </Button>
      </form>

      {data.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card p-10 text-center text-muted-foreground">No delivery partners match.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((p) => (
                <TableRow key={p.id} data-testid="partner-row">
                  <TableCell>
                    <Link href={`/admin/delivery-partners/${p.id}`} className="font-medium text-primary hover:underline">
                      {p.user.fullName ?? p.user.email}
                    </Link>
                    <p className="text-xs text-muted-foreground">{p.user.email}</p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.serviceCity ?? "—"}
                    <p className="text-xs text-muted-foreground">{p.vehicleType ?? "—"}</p>
                  </TableCell>
                  <TableCell>
                    <PartnerStatusBadge status={p.status} online={p.isOnline} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.active}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.delivered}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.failed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination basePath="/admin/delivery-partners" searchParams={sp} page={m.page} totalPages={m.totalPages} />
    </>
  );
}

export default function AdminPartnersPage({ searchParams }: PageProps<"/admin/delivery-partners">) {
  return (
    <>
      <h1 className="mb-6 text-4xl font-semibold text-primary">Delivery partners</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}
