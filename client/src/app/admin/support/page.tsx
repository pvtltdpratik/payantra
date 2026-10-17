import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SupportInbox } from "@/components/admin/support-inbox";
import { Pagination } from "@/components/catalogue/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import { cn } from "@/lib/utils";
import type { PageMeta } from "@/types/catalogue";
import type { AdminSupportRow } from "@/types/analytics";

export const metadata: Metadata = { title: "Support" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const FILTERS = [
  ["", "Everything"],
  ["OPEN", "Open"],
  ["IN_PROGRESS", "In progress"],
  ["RESOLVED", "Resolved"],
  ["CLOSED", "Closed"],
] as const;

async function Body({ searchParams }: Pick<PageProps<"/admin/support">, "searchParams">) {
  const { token } = await requireAdmin("/admin/support");
  const sp = await searchParams;
  const status = FILTERS.find(([s]) => s && s === first(sp.status))?.[0];
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const { data, meta } = await api<AdminSupportRow[]>("/admin/support", { token, cache: "no-store", query: { status, page, pageSize: 20 } });
  const m = meta as unknown as PageMeta;

  return (
    <div className="space-y-6">
      <nav aria-label="Filter requests" className="flex flex-wrap gap-1 text-sm">
        {FILTERS.map(([value, label]) => (
          <Link
            key={value}
            href={value ? `/admin/support?status=${value}` : "/admin/support"}
            aria-current={(status ?? "") === value ? "true" : undefined}
            className={cn("rounded-md px-3 py-1.5 font-medium", (status ?? "") === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
          >
            {label}
          </Link>
        ))}
      </nav>
      {data.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-10 text-center text-muted-foreground">No support requests{status ? " with that status" : ""}.</p>
      ) : (
        <SupportInbox rows={data} />
      )}
      <Pagination basePath="/admin/support" searchParams={sp} page={m.page} totalPages={m.totalPages} />
    </div>
  );
}

export default function AdminSupportPage({ searchParams }: PageProps<"/admin/support">) {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-4xl font-semibold text-primary">Support</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
