import { cn } from "@/lib/utils";
import type { PartnerStatus } from "@/types/delivery";

const TONE: Record<PartnerStatus, string> = {
  PENDING: "bg-warning/10 text-warning border-warning/30",
  APPROVED: "bg-success/10 text-success border-success/30",
  REJECTED: "bg-muted text-muted-foreground border-border",
  SUSPENDED: "bg-destructive/10 text-destructive border-destructive/30",
};

export function PartnerStatusBadge({ status, online }: { status: PartnerStatus; online?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", TONE[status])}>{status.charAt(0) + status.slice(1).toLowerCase()}</span>
      {status === "APPROVED" && (
        <span className={cn("text-xs", online ? "text-success" : "text-muted-foreground")}>{online ? "● online" : "○ offline"}</span>
      )}
    </span>
  );
}
