import { cn, formatINR } from "@/lib/utils";

interface Props {
  price: number;
  basePrice?: number;
  salePrice?: number | null;
  discountPercent?: number;
  className?: string;
  size?: "sm" | "lg";
}

export function Price({ price, basePrice, salePrice, discountPercent, className, size = "sm" }: Props) {
  const onSale = salePrice != null && basePrice != null && salePrice < basePrice;
  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-2", className)}>
      <span className={cn("font-medium text-foreground", size === "lg" ? "text-2xl" : "text-base")}>
        {formatINR(price)}
      </span>
      {onSale && (
        <>
          <span className="sr-only">Original price</span>
          <s className="text-sm text-muted-foreground">{formatINR(basePrice)}</s>
          {discountPercent ? (
            <span className="text-sm font-medium text-success">{discountPercent}% off</span>
          ) : null}
        </>
      )}
    </p>
  );
}
