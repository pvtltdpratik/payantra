import type { Metadata } from "next";
import { Suspense } from "react";
import { DownloadCsv } from "@/components/admin/download-csv";
import { SubscriberToggle } from "@/components/admin/subscriber-toggle";
import { Pagination } from "@/components/catalogue/pagination";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import type { PageMeta } from "@/types/catalogue";
import type { Subscriber } from "@/types/analytics";

export const metadata: Metadata = { title: "Newsletter" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Body({ searchParams }: Pick<PageProps<"/admin/newsletter">, "searchParams">) {
  const { token } = await requireAdmin("/admin/newsletter");
  const sp = await searchParams;
  const q = first(sp.q)?.trim() || undefined;
  const status = first(sp.status) === "subscribed" || first(sp.status) === "unsubscribed" ? first(sp.status) : undefined;
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const { data, meta } = await api<Subscriber[]>("/admin/newsletter", { token, cache: "no-store", query: { q, status, page, pageSize: 25 } });
  const m = meta as unknown as PageMeta & { subscribed: number };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input name="q" defaultValue={q} placeholder="Search emails" aria-label="Search subscribers" className="h-10 w-full max-w-xs rounded-md border border-input bg-card px-3 text-sm" />
          <select name="status" defaultValue={status ?? ""} aria-label="Status" className="h-10 rounded-md border border-input bg-card px-3 text-sm">
            <option value="">Everyone</option>
            <option value="subscribed">Subscribed</option>
            <option value="unsubscribed">Unsubscribed</option>
          </select>
          <Button type="submit" variant="outline" className="h-10">
            Filter
          </Button>
        </form>
        <DownloadCsv path="/admin/newsletter" query={{ ...(q ? { q } : {}), ...(status ? { status } : {}) }} label="Export CSV" />
      </div>
      <p className="mb-4 text-sm text-muted-foreground" data-testid="subscriber-count">
        {m.subscribed.toLocaleString("en-IN")} active subscriber{m.subscribed === 1 ? "" : "s"}
      </p>

      {data.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card p-10 text-center text-muted-foreground">No subscribers match.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s) => (
                <TableRow key={s.id} data-testid="subscriber-row">
                  <TableCell className="font-medium">{s.email}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(s.subscribedAt).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" })}</TableCell>
                  <TableCell className="text-sm">{s.unsubscribedAt ? "Unsubscribed" : "Subscribed"}</TableCell>
                  <TableCell className="text-right">
                    <SubscriberToggle id={s.id} subscribed={!s.unsubscribedAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination basePath="/admin/newsletter" searchParams={sp} page={m.page} totalPages={m.totalPages} />
    </>
  );
}

export default function AdminNewsletterPage({ searchParams }: PageProps<"/admin/newsletter">) {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-4xl font-semibold text-primary">Newsletter</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
