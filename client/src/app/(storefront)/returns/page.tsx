import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PolicyShell } from "@/components/layout/policy-shell";
import { getPublicSettings } from "@/services/home";

export const metadata: Metadata = { title: "Returns & refunds", description: "Payantra's return window, how to start a return and how refunds work." };

async function Window() {
  const s = await getPublicSettings();
  if (!s) return <p>The return window is shown on your order once it is delivered.</p>;
  return (
    <ul data-testid="returns-window">
      <li>You can request a return within {s.returns.returnWindowDays} days of delivery.</li>
      <li>{s.returns.replacementEnabled ? "You can ask for a replacement instead of a refund, subject to stock." : "Replacements are not offered right now; returns are refunded."}</li>
    </ul>
  );
}

export default function ReturnsPage() {
  return (
    <PolicyShell title="Returns & refunds" intro="If a piece isn't right, send it back. Here is how that works.">
      <section>
        <h2>The return window</h2>
        <Suspense fallback={<div className="h-16" aria-hidden />}>
          <Window />
        </Suspense>
      </section>
      <section>
        <h2>How to start a return</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Open the delivered order in <Link href="/account/orders">My orders</Link>.
          </li>
          <li>Choose “Return or replace” and tell us what is wrong.</li>
          <li>We review the request and notify you of the decision.</li>
        </ol>
      </section>
      <section>
        <h2>Refunds</h2>
        <p>Once a return is approved and received, the refund goes back to the payment method you used. Timing depends on your bank.</p>
      </section>
      <section>
        <h2>Condition of items</h2>
        <p>Please return items unworn and unwashed, with tags and packaging, so they can be inspected.</p>
      </section>
    </PolicyShell>
  );
}
