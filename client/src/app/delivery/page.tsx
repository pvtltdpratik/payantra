import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BarChart } from "@/components/charts/bar-chart";
import { AvailabilityToggle } from "@/components/delivery/availability-toggle";
import { JobCard } from "@/components/delivery/job-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/server-session";
import { formatINR } from "@/lib/utils";
import type { DeliveryJob, DeliveryStats, PartnerMe } from "@/types/delivery";

export const metadata: Metadata = { title: "Today" };

function Notice({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-6 text-center" data-testid="partner-notice">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <div className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{children}</div>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" | "bad" | "good" }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-3xl font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : tone === "good" ? "text-success" : ""}`}>{value}</dd>
    </div>
  );
}

async function Body() {
  const { token } = await requireSession("/delivery");
  const { data: me } = await api<PartnerMe>("/delivery/me", { token, cache: "no-store" });

  if (!me.partner) {
    return (
      <Notice
        title="Deliver with Payantra"
        action={
          <Button className="h-12 px-8 text-base" nativeButton={false} render={<Link href="/delivery/apply" />}>
            Apply to deliver
          </Button>
        }
      >
        Bring our orders to customers across your city. Apply once; our team reviews every application before you can start.
      </Notice>
    );
  }

  const p = me.partner;
  if (p.status === "PENDING") {
    return (
      <Notice title="Application received">
        Our team is reviewing your details. You&apos;ll get a notification as soon as there is a decision — you don&apos;t need to do anything else.
      </Notice>
    );
  }
  if (p.status === "REJECTED") {
    return (
      <Notice
        title="Application not approved"
        action={
          <Button className="h-12 px-8 text-base" nativeButton={false} render={<Link href="/delivery/apply" />}>
            Update and apply again
          </Button>
        }
      >
        {p.rejectionReason ? <>Reason: {p.rejectionReason}</> : "We couldn't approve this application."}
      </Notice>
    );
  }
  if (p.status === "SUSPENDED" || me.profile.role !== "DELIVERY_PARTNER") {
    return (
      <Notice title="Your delivery account isn’t active">
        {p.rejectionReason ? <>Reason: {p.rejectionReason}. </> : null}Please contact support to have it reviewed.
      </Notice>
    );
  }

  const [{ data: stats }, { data: jobs }] = await Promise.all([
    api<DeliveryStats>("/delivery/stats", { token, cache: "no-store" }),
    api<DeliveryJob[]>("/delivery/assignments", { token, cache: "no-store", query: { view: "active", pageSize: 50 } }),
  ]);

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold text-primary">Today</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {p.serviceCity ?? "—"} · {p.vehicleType ?? "—"}
          </p>
        </div>
        <AvailabilityToggle initial={p.isOnline} />
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Today's numbers">
        <Tile label="Assigned today" value={stats.today.assigned} />
        <Tile label="Completed" value={stats.today.delivered} tone="good" />
        <Tile label="Pending" value={stats.pending} tone={stats.pending > 0 ? "warn" : undefined} />
        <Tile label="Failed" value={stats.today.failed} tone={stats.today.failed > 0 ? "bad" : undefined} />
      </dl>

      <section aria-labelledby="jobs-h" className="space-y-3">
        <h2 id="jobs-h" className="text-2xl font-semibold">
          Your deliveries
        </h2>
        {jobs.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            {p.isOnline ? "Nothing assigned right now. New deliveries appear here and in your notifications." : "You're offline. Go online to be offered deliveries."}
          </p>
        ) : (
          <ul className="space-y-3">
            {jobs.map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="earn-h" className="space-y-3">
        <h2 id="earn-h" className="text-2xl font-semibold">
          Earnings
        </h2>
        <dl className="grid grid-cols-3 gap-3">
          <Tile label="Today" value={formatINR(stats.earnings.today)} />
          <Tile label="Last 30 days" value={formatINR(stats.earnings.last30Days)} />
          <Tile label="All time" value={formatINR(stats.earnings.allTime)} />
        </dl>
        <p className="text-xs text-muted-foreground">You earn {formatINR(stats.earnings.ratePerDelivery)} for each completed delivery. Payouts are settled by the shop.</p>
      </section>

      <section aria-labelledby="perf-h" className="space-y-3">
        <h2 id="perf-h" className="text-2xl font-semibold">
          Last 14 days
        </h2>
        <div className="rounded-xl border bg-card p-4">
          <BarChart
            title="Deliveries per day over the last 14 days"
            labels={stats.performance.map((d) => d.date.slice(8) + "/" + d.date.slice(5, 7))}
            series={[
              { name: "Delivered", color: "var(--primary)" },
              { name: "Failed", color: "var(--destructive)" },
            ]}
            values={[stats.performance.map((d) => d.delivered), stats.performance.map((d) => d.failed)]}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {stats.deliveredAllTime} delivered in total
          {stats.averageMinutesPickupToDoor !== null && <> · about {stats.averageMinutesPickupToDoor} min from pickup to door</>}
        </p>
      </section>
    </div>
  );
}

export default function DeliveryHomePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Body />
    </Suspense>
  );
}
