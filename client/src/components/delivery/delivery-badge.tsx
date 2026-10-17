import { cn } from "@/lib/utils";
import { DELIVERY_LABEL, type DeliveryStatus } from "@/types/delivery";

const TONE: Record<DeliveryStatus, string> = {
  ASSIGNED: "bg-warning/10 text-warning border-warning/30",
  ACCEPTED: "bg-primary/10 text-primary border-primary/30",
  PICKED_UP: "bg-primary/10 text-primary border-primary/30",
  OUT_FOR_DELIVERY: "bg-primary/10 text-primary border-primary/30",
  DELIVERED: "bg-success/15 text-success border-success/40",
  FAILED: "bg-destructive/10 text-destructive border-destructive/30",
  RETURNED_TO_ORIGIN: "bg-muted text-muted-foreground border-border",
  REJECTED: "bg-muted text-muted-foreground border-border",
};

export function DeliveryBadge({ status, className }: { status: DeliveryStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", TONE[status], className)}>
      {DELIVERY_LABEL[status]}
    </span>
  );
}
