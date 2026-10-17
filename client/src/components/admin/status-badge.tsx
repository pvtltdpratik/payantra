import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  ACTIVE: "bg-success/10 text-success border-success/30",
  DRAFT: "bg-warning/10 text-warning border-warning/30",
  ARCHIVED: "bg-muted text-muted-foreground border-border",
  SUSPENDED: "bg-destructive/10 text-destructive border-destructive/30",
  LOW: "bg-warning/10 text-warning border-warning/30",
  OUT: "bg-destructive/10 text-destructive border-destructive/30",
  OK: "bg-success/10 text-success border-success/30",
};

export function StatusBadge({ status, label }: { status: keyof typeof STYLES | string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STYLES[status] ?? "bg-muted text-muted-foreground border-border",
      )}
    >
      {label ?? status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
