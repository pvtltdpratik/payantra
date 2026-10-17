import { formatINR } from "@/lib/utils";
import type { CartPricing } from "@/types/commerce";

/** Price breakdown. Every figure is computed by the API; this component only displays it. */
export function OrderSummary({ pricing, className }: { pricing: CartPricing; className?: string }) {
  return (
    <dl className={className} data-testid="order-summary">
      <div className="flex justify-between py-1.5 text-sm">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="tabular-nums">{formatINR(pricing.subtotal)}</dd>
      </div>
      {pricing.discountTotal > 0 && (
        <div className="flex justify-between py-1.5 text-sm text-success">
          <dt>Coupon {pricing.couponCode && <span className="font-medium">({pricing.couponCode})</span>}</dt>
          <dd className="tabular-nums">−{formatINR(pricing.discountTotal)}</dd>
        </div>
      )}
      <div className="flex justify-between py-1.5 text-sm">
        <dt className="text-muted-foreground">Delivery</dt>
        <dd className="tabular-nums">{pricing.shippingTotal === 0 ? "Free" : formatINR(pricing.shippingTotal)}</dd>
      </div>
      <div className="mt-2 flex justify-between border-t pt-3 text-base font-semibold">
        <dt>Total</dt>
        <dd className="tabular-nums" data-testid="grand-total">
          {formatINR(pricing.grandTotal)}
        </dd>
      </div>
      <p className="mt-1 text-right text-xs text-muted-foreground">
        Inclusive of {formatINR(pricing.taxTotal)} GST
      </p>
    </dl>
  );
}
