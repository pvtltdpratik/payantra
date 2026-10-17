import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DateRangeForm } from "@/components/admin/date-range-form";
import { DownloadCsv } from "@/components/admin/download-csv";
import { ReportTable } from "@/components/admin/report-table";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { istDateKey, rangeFromParams } from "@/lib/ist";
import { requireAdmin } from "@/lib/server-session";
import { cn } from "@/lib/utils";
import type { Report, ReportName } from "@/types/analytics";

export const metadata: Metadata = { title: "Reports" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const TABS: { name: ReportName; label: string; blurb: string; usesDates: boolean }[] = [
  { name: "sales", label: "Sales", blurb: "Paid orders, discounts, delivery charges, GST and refunds, grouped by day, week or month.", usesDates: true },
  { name: "products", label: "Products", blurb: "What sold, ranked by revenue. Cancelled orders are left out.", usesDates: true },
  { name: "inventory", label: "Inventory", blurb: "Stock on hand, reserved and available for every active variant, valued at selling price.", usesDates: false },
  { name: "payments", label: "Payments & refunds", blurb: "Every payment received and refund sent, newest first.", usesDates: true },
  { name: "delivery", label: "Delivery", blurb: "Each partner's deliveries, failures, speed and earnings.", usesDates: true },
];
const GRANULARITIES = [
  ["day", "Daily"],
  ["week", "Weekly"],
  ["month", "Monthly"],
] as const;

async function Body({ searchParams }: Pick<PageProps<"/admin/analytics">, "searchParams">) {
  const { token } = await requireAdmin("/admin/analytics");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.name === first(sp.report)) ?? TABS[0];
  const granularity = GRANULARITIES.find(([g]) => g === first(sp.granularity))?.[0] ?? "day";
  const lowOnly = first(sp.lowStockOnly) === "true";
  const now = new Date();
  const range = rangeFromParams(first(sp.from), first(sp.to), now);
  const query: Record<string, string> = { from: range.from, to: range.to, ...(tab.name === "sales" ? { granularity } : {}), ...(tab.name === "inventory" && lowOnly ? { lowStockOnly: "true" } : {}) };

  const { data: report } = await api<Report>(`/admin/reports/${tab.name}`, { token, cache: "no-store", query });
  const keep = { report: tab.name, ...(tab.name === "sales" ? { granularity } : {}) };
  const tabHref = (name: ReportName) => `/admin/analytics?${new URLSearchParams({ report: name, from: range.from, to: range.to }).toString()}`;

  return (
    <div className="space-y-6">
      <nav aria-label="Reports" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <Link
            key={t.name}
            href={tabHref(t.name)}
            aria-current={t.name === tab.name ? "page" : undefined}
            className={cn("shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium", t.name === tab.name ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <p className="text-sm text-muted-foreground">{tab.blurb}</p>

      <div className="flex flex-wrap items-end justify-between gap-4">
        {tab.usesDates ? (
          <DateRangeForm basePath="/admin/analytics" from={range.from} to={range.to} today={istDateKey(now)} extra={keep} />
        ) : (
          <div className="mb-6 flex gap-2 text-sm">
            <Link href="/admin/analytics?report=inventory" className={cn("rounded-md px-3 py-2 font-medium", !lowOnly ? "bg-muted" : "text-muted-foreground hover:bg-muted")}>
              All items
            </Link>
            <Link href="/admin/analytics?report=inventory&lowStockOnly=true" className={cn("rounded-md px-3 py-2 font-medium", lowOnly ? "bg-muted" : "text-muted-foreground hover:bg-muted")}>
              Low and sold out
            </Link>
          </div>
        )}
        <div className="mb-6">
          <DownloadCsv path={`/admin/reports/${tab.name}`} query={query} />
        </div>
      </div>

      {tab.name === "sales" && (
        <nav aria-label="Group by" className="flex gap-1 text-sm">
          {GRANULARITIES.map(([g, label]) => (
            <Link
              key={g}
              href={`/admin/analytics?${new URLSearchParams({ report: "sales", from: range.from, to: range.to, granularity: g }).toString()}`}
              aria-current={g === granularity ? "true" : undefined}
              className={cn("rounded-md px-3 py-1.5 font-medium", g === granularity ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}

      <h2 className="text-2xl font-semibold" data-testid="report-title">
        {report.title}
      </h2>
      <ReportTable report={report} />
    </div>
  );
}

export default function AdminAnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-4xl font-semibold text-primary">Reports</h1>
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
