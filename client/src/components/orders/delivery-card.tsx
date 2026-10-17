import { Phone, ShieldCheck, Truck } from "lucide-react";
import { DELIVERY_LABEL, type CustomerDelivery } from "@/types/delivery";

/**
 * The delivery partner's progress and, while the parcel is out for delivery, the one-time code the customer
 * reads out at the door. The code is for the customer only: it is how a handover is proven.
 */
export function DeliveryCard({ delivery }: { delivery: CustomerDelivery | null }) {
  if (!delivery) return null;
  const out = delivery.status === "OUT_FOR_DELIVERY";

  return (
    <section aria-labelledby="delivery-h" className="space-y-3 rounded-xl border bg-card p-5" data-testid="delivery-card">
      <h2 id="delivery-h" className="flex items-center gap-2 text-2xl font-semibold">
        <Truck aria-hidden className="size-5 text-primary" /> Delivery
      </h2>

      <p className="text-sm">
        <strong data-testid="delivery-status">{DELIVERY_LABEL[delivery.status]}</strong>
        {delivery.partnerName && <span className="text-muted-foreground"> · with {delivery.partnerName}</span>}
      </p>

      {out && delivery.code && (
        <div className="rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-4 text-center">
          <p className="flex items-center justify-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
            <ShieldCheck aria-hidden className="size-4" /> Your delivery code
          </p>
          <p className="my-2 font-mono text-4xl font-semibold tracking-[0.35em] text-primary" data-testid="delivery-code" aria-label={`Delivery code ${delivery.code.split("").join(" ")}`}>
            {delivery.code}
          </p>
          <p className="text-xs text-muted-foreground">Tell this code to the delivery partner only when you have your parcel. Don&apos;t share it before.</p>
        </div>
      )}
      {out && delivery.codeLocked && (
        <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          The code was entered wrongly too many times. Contact support and we&apos;ll issue a new one.
        </p>
      )}
      {out && delivery.codeExpired && (
        <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          Your delivery code has expired. Contact support and we&apos;ll issue a new one.
        </p>
      )}

      {delivery.status === "FAILED" && (
        <p role="status" className="rounded-md border bg-muted px-3 py-2 text-sm">
          We couldn&apos;t deliver this time{delivery.failureReason ? ` (${delivery.failureReason.toLowerCase()})` : ""}. We&apos;ll try again or get in touch.
        </p>
      )}

      {out && delivery.partnerPhone && (
        <a href={`tel:+91${delivery.partnerPhone}`} className="inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted">
          <Phone aria-hidden className="size-4" /> Call {delivery.partnerName ?? "your delivery partner"}
        </a>
      )}
    </section>
  );
}
