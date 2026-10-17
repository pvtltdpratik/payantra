import Link from "next/link";
import { Banknote, ChevronRight, MapPin, PackageCheck } from "lucide-react";
import { formatINR } from "@/lib/utils";
import type { DeliveryJob } from "@/types/delivery";
import { DeliveryBadge } from "./delivery-badge";

/** One delivery in a list. Shows the area, never the customer's name or phone (those appear once the job is accepted). */
export function JobCard({ job }: { job: DeliveryJob }) {
  return (
    <li>
      <Link
        href={`/delivery/orders/${job.id}`}
        className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:border-primary/40 focus-visible:outline-2"
        data-testid="delivery-job"
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{job.order.orderNumber}</span>
            <DeliveryBadge status={job.status} />
          </div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin aria-hidden className="size-4 shrink-0" />
            {job.address.city}, {job.address.state} {job.address.postalCode}
          </p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <PackageCheck aria-hidden className="size-4" /> {job.order.itemCount} item{job.order.itemCount === 1 ? "" : "s"}
            </span>
            {job.order.collectCash > 0 && (
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <Banknote aria-hidden className="size-4" /> Collect {formatINR(job.order.collectCash)}
              </span>
            )}
            {job.payoutAmount !== null && <span>Earned {formatINR(job.payoutAmount)}</span>}
          </p>
        </div>
        <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}
