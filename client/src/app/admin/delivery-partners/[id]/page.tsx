import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PartnerDecision } from "@/components/admin/partner-decision";
import { PartnerStatusBadge } from "@/components/admin/partner-status-badge";
import { DeliveryBadge } from "@/components/delivery/delivery-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { requireAdmin } from "@/lib/server-session";
import { formatINR } from "@/lib/utils";
import type { AdminPartnerDetail } from "@/types/delivery";

export const metadata: Metadata = { title: "Delivery partner" };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

async function Body({ params }: Pick<PageProps<"/admin/delivery-partners/[id]">, "params">) {
  const { id } = await params;
  const { token } = await requireAdmin(`/admin/delivery-partners/${id}`);
  let p: AdminPartnerDetail;
  try {
    p = (await api<AdminPartnerDetail>(`/admin/delivery-partners/${encodeURIComponent(id)}`, { token, cache: "no-store" })).data;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold text-primary" data-testid="partner-name">
            {p.user.fullName ?? p.user.email}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {p.user.email} · {p.user.phone ? `+91 ${p.user.phone}` : "no phone"}
          </p>
        </div>
        <PartnerStatusBadge status={p.status} online={p.isOnline} />
      </header>

      {p.rejectionReason && (p.status === "REJECTED" || p.status === "SUSPENDED") && (
        <p className="rounded-md border bg-muted px-4 py-3 text-sm">
          <strong>{p.status === "REJECTED" ? "Rejected" : "Suspended"}:</strong> {p.rejectionReason}
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          <PartnerDecision partner={p} />

          <section aria-labelledby="recent-h" className="space-y-3">
            <h2 id="recent-h" className="text-2xl font-semibold">
              Recent deliveries
            </h2>
            {p.recent.length === 0 ? (
              <p className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">No deliveries yet.</p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card text-sm">
                {p.recent.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <span>
                      <Link href={`/admin/orders/${r.orderId}`} className="font-medium text-primary hover:underline">
                        {r.orderNumber}
                      </Link>
                      <span className="text-muted-foreground"> · {r.city} · {when(r.assignedAt)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {r.status === "DELIVERED" && <span className="text-muted-foreground">{formatINR(r.payoutAmount)}</span>}
                      <DeliveryBadge status={r.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-8">
          <section aria-labelledby="perf-h">
            <h2 id="perf-h" className="mb-2 text-2xl font-semibold">
              Performance
            </h2>
            <dl className="divide-y rounded-xl border bg-card px-4" data-testid="partner-stats">
              <Row label="Delivered">{p.stats.delivered}</Row>
              <Row label="In progress">{p.stats.inProgress}</Row>
              <Row label="Failed (open)">{p.stats.failed}</Row>
              <Row label="Returned to origin">{p.stats.returnedToOrigin}</Row>
              <Row label="Declined">{p.stats.rejected}</Row>
              <Row label="Earned, all time">{formatINR(p.stats.earningsAllTime)}</Row>
              <Row label="Rate per delivery">{formatINR(p.perDeliveryPayout)}</Row>
            </dl>
          </section>

          <section aria-labelledby="app-h">
            <h2 id="app-h" className="mb-2 text-2xl font-semibold">
              Application
            </h2>
            <dl className="divide-y rounded-xl border bg-card px-4">
              <Row label="City">{p.serviceCity ?? "—"}</Row>
              <Row label="Vehicle">{[p.vehicleType, p.vehicleNumber].filter(Boolean).join(" · ") || "—"}</Row>
              <Row label="ID document">{p.idDocumentType ?? "—"}</Row>
              <Row label="Reference">{p.idDocumentRef ?? "—"}</Row>
              <Row label="Applied">{when(p.createdAt)}</Row>
              <Row label="Approved">{when(p.approvedAt)}</Row>
            </dl>
            {p.applicationNote && <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">{p.applicationNote}</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}

export default function AdminPartnerPage({ params }: PageProps<"/admin/delivery-partners/[id]">) {
  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/admin/delivery-partners" className="text-sm text-muted-foreground hover:text-primary">
        ← Delivery partners
      </Link>
      <div className="mt-3">
        <Suspense fallback={<Skeleton className="h-[32rem]" />}>
          <Body params={params} />
        </Suspense>
      </div>
    </div>
  );
}
