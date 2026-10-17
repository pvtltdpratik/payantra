import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Read-only stars. The words are for screen readers; the icons are decoration. */
export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} aria-hidden className={cn("size-4", n <= Math.round(value) ? "fill-gold text-gold" : "text-muted-foreground/40")} />
      ))}
      <span className="sr-only">{value} out of 5 stars</span>
    </span>
  );
}
