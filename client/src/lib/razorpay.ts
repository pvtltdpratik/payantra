import type { RazorpayCheckoutParams } from "@/types/commerce";

/** What Razorpay Checkout hands back after a successful payment. */
export interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (r: { error?: { description?: string } }) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

export const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

export interface RazorpayHandlers {
  /** The payment succeeded in the browser. The caller MUST still verify it with the API. */
  onPaid(response: RazorpayResponse): void;
  /** The shopper closed the window without paying. */
  onDismiss(): void;
  onFailed(message: string): void;
}

/**
 * Opens Razorpay Checkout for an order the API already created. Returns false when the script has not
 * loaded (ad-blocker, offline), so the caller can explain instead of silently doing nothing.
 *
 * Nothing here decides whether the order is paid: the browser only reports what Razorpay told it, and
 * the server confirms with a signature check, a provider lookup and the webhook.
 */
export function openRazorpayCheckout(p: RazorpayCheckoutParams, h: RazorpayHandlers): boolean {
  if (typeof window === "undefined" || !window.Razorpay) return false;

  let settled = false; // `ondismiss` also fires after a successful payment closes the window
  const rzp = new window.Razorpay({
    key: p.keyId,
    order_id: p.razorpayOrderId,
    amount: p.amount,
    currency: p.currency,
    name: p.name,
    description: p.description,
    prefill: p.prefill,
    theme: { color: "#5c1a2b" },
    handler: (r: RazorpayResponse) => {
      settled = true;
      h.onPaid(r);
    },
    modal: {
      ondismiss: () => {
        if (!settled) h.onDismiss();
      },
    },
  });
  rzp.on("payment.failed", (r) => {
    if (settled) return;
    settled = true;
    h.onFailed(r.error?.description ?? "Your payment did not go through.");
  });
  rzp.open();
  return true;
}
