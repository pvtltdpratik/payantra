import { Star } from "lucide-react";

export function Rating({ value, count }: { value: number; count: number }) {
  if (count === 0) return null;
  return (
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      <Star aria-hidden className="size-3.5 fill-gold text-gold" />
      <span className="font-medium text-foreground">{value.toFixed(1)}</span>
      <span aria-hidden>({count})</span>
      <span className="sr-only">
        rated {value.toFixed(1)} out of 5 from {count} reviews
      </span>
    </p>
  );
}
