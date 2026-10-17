import type { Metadata } from "next";
import { Suspense } from "react";
import { ReturnsTable } from "@/components/admin/returns-table";
import { Pagination } from "@/components/catalogue/pagination";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import type { AdminReturnRow } from "@/types/admin";
import type { PageMeta } from "@/types/catalogue";

export const metadata: Metadata = { title: "Returns" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Body({ searchParams }: Pick<PageProps<"/admin/returns">, "searchParams">) {
  const { token } = await requireAdmin("/admin/returns");
  const sp = await searchParams;
  const status = ["REQUESTED", "APPROVED", "REJECTED", "COMPLETED"].includes(first(sp.status) ?? "") ? first(sp.status) : undefined;
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const { data, meta } = await api<AdminReturnRow[]>("/admin/returns", { token, query: { status, page, pageSize: 20 }, cache: "no-store" });
  const m = meta as unknown as PageMeta;

  return (
    <>
      <form method="get" className="mb-6 flex items-center gap-2">
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className="h-10 rounded-md border border-input bg-card px-3 text-sm">
          <option value="">All requests</option>
          <option value="REQUESTED">Awaiting review</option>
          <option value="APPROVED">Approved</option>
          <option value="COMPLETED">Completed</option>
          <option value="REJECTED">Declined</option>
        </select>
        <Button type="submit" variant="outline" className="h-10">
          Filter
        </Button>
      </form>
      {data.length === 0 ? <p className="rounded-lg border border-dashed bg-card p-10 text-center text-muted-foreground">No return requests.</p> : <ReturnsTable rows={data} />}
      <Pagination basePath="/admin/returns" searchParams={sp} page={m.page} totalPages={m.totalPages} />
    </>
  );
}

export default function AdminReturnsPage({ searchParams }: PageProps<"/admin/returns">) {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-4xl font-semibold text-primary">Returns &amp; replacements</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
