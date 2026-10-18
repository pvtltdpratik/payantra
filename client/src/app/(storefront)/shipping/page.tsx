import type { Metadata } from "next";
import { Suspense } from "react";
import { PolicyShell } from "@/components/layout/policy-shell";
import { formatINR } from "@/lib/utils";
import { getPublicSettings } from "@/services/home";

export const metadata: Metadata = { title: "Shipping & delivery", description: "How Payantra delivers your order, what it costs and how to track it." };

/** The numbers come from the same store settings checkout uses, so this page can never disagree with the basket. */
async function Rates() {
  const s = await getPublicSettings();
  if (!s) return <p>Delivery charges are shown at checkout before you pay.</p>;
  const { flatRate, freeThreshold } = s.shipping;
  return (
    <ul data-testid="shipping-rates">
      <li>{freeThreshold === 0 ? "Delivery is free on every order." : `Delivery is free on orders of ${formatINR(freeThreshold)} or more.`}</li>
      {freeThreshold > 0 && <li>{flatRate === 0 ? "Smaller orders are delivered free as well." : `Orders below that pay a flat ${formatINR(flatRate)}.`}</li>}
      <li>
        {s.payments.codEnabled ? `Cash on delivery is available on orders up to ${formatINR(s.payments.codMaxOrder)}.` : "Cash on delivery is not available right now; pay online by UPI, card or net banking."}
      </li>
    </ul>
  );
}

export default function ShippingPage() {
  return (
    <PolicyShell title="Shipping & delivery" intro="We deliver across India, and you can follow every order from our warehouse to your door.">
      <section>
        <h2>Charges</h2>
        <Suspense fallback={<div className="h-24" aria-hidden />}>
          <Rates />
        </Suspense>
      </section>
      <section>
        <h2>Tracking your order</h2>
        <p>
          Once your order is packed, you can follow it from <strong>My orders</strong> in your account: placed, packed, shipped, out for delivery and delivered. We also send a notification at each step.
        </p>
      </section>
      <section>
        <h2>Delivery times</h2>
        <p>Delivery time depends on where you are and on the delivery partner assigned to your order. You will see each status change in your account, and we will notify you if an order is delayed.</p>
      </section>
      <section>
        <h2>If something goes wrong</h2>
        <p>If an order arrives damaged or incorrect, raise it from the order page or contact us and we will make it right. See also our returns policy.</p>
      </section>
    </PolicyShell>
  );
}
