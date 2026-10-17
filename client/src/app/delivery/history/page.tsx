import type { Metadata } from "next";
import { Suspense } from "react";
import { Pagination } from "@/components/catalogue/pagination";
import { JobCard } from "@/components/delivery/job-card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/server-session";
import type { PageMeta } from "@/types/catalogue";
import type { DeliveryJob } from "@/types/delivery";

export const metadata: Metadata = { title: "History" };

async function Body({ searchParams }: Pick<PageProps<"/delivery/history">, "searchParams">) {
  const { token, me } = await requireSession("/delivery/history");
  const sp = await searchParams;
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);

  if (me.role !== "DELIVERY_PARTNER") {
    return <p className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">Delivery history is available to approved partners.</p>;
  }
  const { data, meta } = await api<DeliveryJob[]>("/delivery/assignments", { token, cache: "no-store", query: { view: "history", page, pageSize: 20 } });
  const m = meta as unknown as PageMeta;

  return data.length === 0 ? (
    <p className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">No completed deliveries yet.</p>
  ) : (
    <>
      <ul className="space-y-3">
        {data.map((j) => (
          <JobCard key={j.id} job={j} />
        ))}
      </ul>
      <Pagination basePath="/delivery/history" searchParams={sp} page={m.page} totalPages={m.totalPages} />
    </>
  );
}

export default function HistoryPage({ searchParams }: PageProps<"/delivery/history">) {
  return (
    <div className="space-y-6">
      <h1 className="text-4xl font-semibold text-primary">History</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
