import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ReviewModeration, type ModerationRow } from "@/components/admin/review-moderation";
import { Pagination } from "@/components/catalogue/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import { cn } from "@/lib/utils";
import type { PageMeta } from "@/types/catalogue";

export const metadata: Metadata = { title: "Reviews" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const FILTERS = [
  ["", "All"],
  ["visible", "Visible"],
  ["hidden", "Hidden"],
] as const;

async function Body({ searchParams }: Pick<PageProps<"/admin/reviews">, "searchParams">) {
  const { token } = await requireAdmin("/admin/reviews");
  const sp = await searchParams;
  const status = FILTERS.find(([s]) => s && s === first(sp.status))?.[0];
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const { data, meta } = await api<ModerationRow[]>("/admin/reviews", { token, cache: "no-store", query: { status, page, pageSize: 20 } });
  const m = meta as unknown as PageMeta;

  return (
    <div className="space-y-6">
      <nav aria-label="Filter reviews" className="flex gap-1 text-sm">
        {FILTERS.map(([value, label]) => (
          <Link
            key={value}
            href={value ? `/admin/reviews?status=${value}` : "/admin/reviews"}
            aria-current={(status ?? "") === value ? "true" : undefined}
            className={cn("rounded-md px-3 py-1.5 font-medium", (status ?? "") === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
          >
            {label}
          </Link>
        ))}
      </nav>
      {data.length === 0 ? <p className="rounded-xl border border-dashed bg-card p-10 text-center text-muted-foreground">No reviews to show.</p> : <ReviewModeration rows={data} />}
      <Pagination basePath="/admin/reviews" searchParams={sp} page={m.page} totalPages={m.totalPages} />
    </div>
  );
}

export default function AdminReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-2 text-4xl font-semibold text-primary">Reviews</h1>
      <p className="mb-6 text-sm text-muted-foreground">Every review comes from a delivered order. Hide one to remove it from the product page and the rating; the customer can still see it, marked hidden.</p>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
