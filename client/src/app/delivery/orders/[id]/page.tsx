import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Banknote, MapPinned, Phone } from "lucide-react";
import { DeliveryBadge } from "@/components/delivery/delivery-badge";
import { JobActions } from "@/components/delivery/job-actions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { requireSession } from "@/lib/server-session";
import { formatINR } from "@/lib/utils";
import { DELIVERY_LABEL, type DeliveryJob } from "@/types/delivery";

export const metadata: Metadata = { title: "Delivery" };

async function Body({ params }: Pick<PageProps<"/delivery/orders/[id]">, "params">) {
  const { id } = await params;
  const { token } = await requireSession(`/delivery/orders/${id}`);
  let job: DeliveryJob;
  try {
    job = (await api<DeliveryJob>(`/delivery/assignments/${encodeURIComponent(id)}`, { token, cache: "no-store" })).data;
  } catch (err) {
    // Someone else's job, a missing one and a non-partner all look the same.
    if (err instanceof ApiError && [400, 403, 404].includes(err.status)) notFound();
    throw err;
  }

  const a = job.address;
  const fullAddress = [a.line1, a.line2, a.landmark, a.city, a.state, a.postalCode].filter(Boolean).join(", ");
  const mapHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress || `${a.city} ${a.postalCode}`)}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold text-primary">{job.order.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assigned {new Date(job.assignedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
        <DeliveryBadge status={job.status} className="text-sm" />
      </header>

      {job.order.collectCash > 0 && job.status !== "DELIVERED" && (
        <p className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-lg font-semibold" data-testid="collect-cash">
          <Banknote aria-hidden className="size-6" /> Collect {formatINR(job.order.collectCash)} in cash
        </p>
      )}

      <section aria-labelledby="where-h" className="space-y-3 rounded-xl border bg-card p-5">
        <h2 id="where-h" className="text-2xl font-semibold">
          Deliver to
        </h2>
        {a.line1 ? (
          <address className="text-base not-italic" data-testid="delivery-address">
            <strong>{a.fullName}</strong>
            <br />
            {[a.line1, a.line2, a.landmark].filter(Boolean).join(", ")}
            <br />
            {a.city}, {a.state} {a.postalCode}
          </address>
        ) : (
          <p className="text-base" data-testid="delivery-area">
            {a.city}, {a.state} {a.postalCode}
            {job.status === "ASSIGNED" && <span className="mt-1 block text-sm text-muted-foreground">Accept the delivery to see the full address and contact number.</span>}
          </p>
        )}
        {(a.line1 || job.customerPhone) && (
          <div className="flex flex-wrap gap-3 pt-1">
            {a.line1 && (
              <Button variant="outline" className="h-11" nativeButton={false} render={<a href={mapHref} target="_blank" rel="noopener noreferrer" />}>
                <MapPinned aria-hidden /> Open in Maps
              </Button>
            )}
            {job.customerPhone && (
              <Button variant="outline" className="h-11" nativeButton={false} render={<a href={`tel:+91${job.customerPhone}`} />}>
                <Phone aria-hidden /> Call customer
              </Button>
            )}
          </div>
        )}
      </section>

      {job.order.items.length > 0 && (
        <section aria-labelledby="items-h" className="space-y-2">
          <h2 id="items-h" className="text-2xl font-semibold">
            Parcel
          </h2>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {job.order.items.map((i, k) => (
              <li key={k} className="flex justify-between gap-3 p-3">
                <span>
                  {i.name}
                  <span className="block text-muted-foreground">{[i.colour, i.size && `Size ${i.size}`].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="tabular-nums">× {i.quantity}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {job.failureReason && (job.status === "FAILED" || job.status === "RETURNED_TO_ORIGIN" || job.status === "REJECTED") && (
        <p className="rounded-md border bg-muted px-4 py-3 text-sm">
          <strong>{DELIVERY_LABEL[job.status]}:</strong> {job.failureReason}
        </p>
      )}

      <JobActions job={job} />

      <section aria-labelledby="hist-h" className="space-y-2">
        <h2 id="hist-h" className="text-2xl font-semibold">
          Activity
        </h2>
        <ol className="space-y-2 text-sm">
          {job.history.map((h, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 rounded-md border bg-card px-3 py-2">
              <span>
                {DELIVERY_LABEL[h.status]}
                {h.reason && <span className="text-muted-foreground"> — {h.reason}</span>}
              </span>
              <time className="text-muted-foreground" dateTime={h.at}>
                {new Date(h.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
              </time>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function DeliveryJobPage({ params }: PageProps<"/delivery/orders/[id]">) {
  return (
    <div className="space-y-4">
      <Link href="/delivery" className="text-sm text-muted-foreground hover:text-primary">
        ← Today
      </Link>
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <Body params={params} />
      </Suspense>
    </div>
  );
}
