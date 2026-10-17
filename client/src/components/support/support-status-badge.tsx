import { cn } from "@/lib/utils";
import type { SupportStatus } from "@/types/analytics";

const TONE: Record<SupportStatus, string> = {
  OPEN: "bg-warning/10 text-warning border-warning/30",
  IN_PROGRESS: "bg-primary/10 text-primary border-primary/30",
  RESOLVED: "bg-success/10 text-success border-success/30",
  CLOSED: "bg-muted text-muted-foreground border-border",
};
const LABEL: Record<SupportStatus, string> = { OPEN: "Open", IN_PROGRESS: "In progress", RESOLVED: "Resolved", CLOSED: "Closed" };

export function SupportStatusBadge({ status }: { status: SupportStatus }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", TONE[status])}>{LABEL[status]}</span>;
}
