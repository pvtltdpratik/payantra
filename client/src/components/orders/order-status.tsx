import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, TIMELINE_STAGES, type FulfilmentStatus, type OrderView, type PaymentStatus } from "@/types/commerce";

const FULFILMENT_TONE: Record<FulfilmentStatus, string> = {
  PLACED: "bg-warning/10 text-warning border-warning/30",
  PAYMENT_CONFIRMED: "bg-success/10 text-success border-success/30",
  PROCESSING: "bg-success/10 text-success border-success/30",
  PACKED: "bg-success/10 text-success border-success/30",
  SHIPPED: "bg-primary/10 text-primary border-primary/30",
  OUT_FOR_DELIVERY: "bg-primary/10 text-primary border-primary/30",
  DELIVERED: "bg-success/15 text-success border-success/40",
  CANCELLED: "bg-destructive/10 text-destructive border-destructive/30",
  RETURN_REQUESTED: "bg-warning/10 text-warning border-warning/30",
  RETURNED: "bg-muted text-muted-foreground border-border",
};

export function OrderStatusBadge({ status }: { status: FulfilmentStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", FULFILMENT_TONE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Payment pending",
  AUTHORIZED: "Payment authorised",
  CAPTURED: "Paid",
  FAILED: "Not paid",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partly refunded",
};

export function PaymentStatusText({ status, method }: { status: PaymentStatus; method: "RAZORPAY" | "COD" }) {
  if (method === "COD" && status === "PENDING") return <>Cash on delivery</>;
  return <>{PAYMENT_LABEL[status]}</>;
}

/**
 * Order tracking: Placed → Payment confirmed → Processing → Packed → Shipped → Out for delivery → Delivered.
 * Reached steps come from the order's own history, so the timeline can never claim more than happened.
 */
export function OrderTimeline({ order }: { order: Pick<OrderView, "timeline" | "fulfilmentStatus" | "paymentMethod"> }) {
  const reached = new Set(order.timeline.map((t) => t.status));
  const at = new Map(order.timeline.map((t) => [t.status, t.at]));
  const cancelled = order.fulfilmentStatus === "CANCELLED";
  const afterDelivery = (["RETURN_REQUESTED", "RETURNED"] as const).filter((s) => reached.has(s));

  // The furthest happy-path stage reached is the "current" one.
  const lastReached = [...TIMELINE_STAGES].reverse().find((s) => reached.has(s));
  const stages: FulfilmentStatus[] = [...TIMELINE_STAGES, ...afterDelivery];

  return (
    <ol aria-label="Order progress" className="space-y-0" data-testid="order-timeline">
      {stages.map((s, i) => {
        const done = reached.has(s);
        const current = !cancelled && (s === lastReached || (afterDelivery.length > 0 && s === afterDelivery.at(-1)));
        const label = s === "PLACED" ? "Order placed" : s === "PAYMENT_CONFIRMED" && order.paymentMethod === "COD" ? "Order confirmed" : STATUS_LABEL[s];
        return (
          <li key={s} className="relative flex gap-4 pb-6 last:pb-0" aria-current={current ? "step" : undefined} data-state={done ? "done" : "todo"}>
            {i < stages.length - 1 && <span aria-hidden className={cn("absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5", done && reached.has(stages[i + 1]) ? "bg-primary" : "bg-border")} />}
            <span
              aria-hidden
              className={cn(
                "relative z-10 grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs",
                done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground",
                current && "ring-4 ring-primary/20",
              )}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <div className="pt-0.5">
              <p className={cn("text-sm font-medium", !done && "text-muted-foreground")}>
                {label}
                <span className="sr-only">{done ? " — completed" : " — not yet"}</span>
              </p>
              {at.get(s) && <p className="text-xs text-muted-foreground">{new Date(at.get(s)!).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>}
            </div>
          </li>
        );
      })}

      {cancelled && (
        <li className="relative flex gap-4 pt-6" aria-current="step">
          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-destructive bg-destructive text-destructive-foreground">
            <X className="size-3.5" />
          </span>
          <div className="pt-0.5">
            <p className="text-sm font-medium text-destructive">Cancelled</p>
            {at.get("CANCELLED") && <p className="text-xs text-muted-foreground">{new Date(at.get("CANCELLED")!).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>}
          </div>
        </li>
      )}
    </ol>
  );
}
