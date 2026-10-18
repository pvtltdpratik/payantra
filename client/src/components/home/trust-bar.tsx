import { REVEAL } from "@/lib/motion";
import { CreditCard, PackageCheck, RotateCcw, Truck } from "lucide-react";
import { getPublicSettings } from "@/services/home";
import { formatINR } from "@/lib/utils";

/**
 * Four reassurances under the hero. They quote the SAME numbers checkout uses (read from the public settings), so
 * the promise on the home page can never disagree with the basket. If the settings are unavailable the bar is left
 * out rather than guessing.
 */
export async function TrustBar() {
  const s = await getPublicSettings();
  if (!s) return null;

  const delivery = s.shipping.freeThreshold === 0 ? "Free delivery on every order" : `Free delivery over ${formatINR(s.shipping.freeThreshold)}`;
  const items = [
    { Icon: Truck, title: delivery, note: s.shipping.flatRate === 0 ? "Delivered across India" : `${formatINR(s.shipping.flatRate)} below that, across India` },
    { Icon: RotateCcw, title: `${s.returns.returnWindowDays}-day returns`, note: s.returns.replacementEnabled ? "Return or replace, hassle-free" : "Easy returns on delivered orders" },
    { Icon: CreditCard, title: "Secure payments", note: "UPI, cards and net banking via Razorpay" },
    { Icon: PackageCheck, title: s.payments.codEnabled ? "Cash on delivery" : "Tracked delivery", note: s.payments.codEnabled ? `Pay at your door, up to ${formatINR(s.payments.codMaxOrder)}` : "Follow your order to your door" },
  ];

  return (
    <section aria-label="Why shop with Payantra" className="border-b bg-secondary/60" data-testid="trust-bar">
      <ul className="mx-auto grid max-w-7xl grid-cols-2 gap-x-4 gap-y-5 px-4 py-6 lg:grid-cols-4">
        {items.map(({ Icon, title, note }) => (
          <li key={title} className="flex items-start gap-3" {...REVEAL}>
            <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">{title}</p>
              <p className="text-xs text-muted-foreground">{note}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Same box as the real bar, so streaming it in causes no layout shift. It renders the same four items with
 * placeholder words of a similar length, hidden with `invisible` (which keeps their size), so the text wraps and the
 * bar grows at exactly the same widths as the real one (about 193 px on a phone, 85 px on a desktop).
 */
export const TrustBarSkeleton = () => (
  <div className="border-b bg-secondary/60" aria-hidden>
    <ul className="invisible mx-auto grid max-w-7xl grid-cols-2 gap-x-4 gap-y-5 px-4 py-6 lg:grid-cols-4">
      {[
        ["Free delivery over ₹2,999", "₹99 below that, across India"],
        ["7-day returns", "Return or replace, hassle-free"],
        ["Secure payments", "UPI, cards and net banking via Razorpay"],
        ["Cash on delivery", "Pay at your door, up to ₹20,000"],
      ].map(([title, note]) => (
        <li key={title} className="flex items-start gap-3">
          <span className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground">{note}</p>
          </div>
        </li>
      ))}
    </ul>
  </div>
);
