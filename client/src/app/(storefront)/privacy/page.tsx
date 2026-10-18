import type { Metadata } from "next";
import Link from "next/link";
import { PolicyShell } from "@/components/layout/policy-shell";

export const metadata: Metadata = { title: "Privacy policy", description: "What Payantra collects, why, and the choices you have." };

/** Plain-language summary of what the application does with data. Have counsel review before launch. */
export default function PrivacyPage() {
  return (
    <PolicyShell title="Privacy policy" intro="We collect what we need to deliver your order and look after your account, and nothing more.">
      <section>
        <h2>What we collect</h2>
        <ul>
          <li>Your name, email and phone number when you create an account or place an order.</li>
          <li>Delivery addresses you save, and your order history.</li>
          <li>Your wishlist, bag and recently viewed products, to make shopping easier.</li>
          <li>Reviews and support requests you write.</li>
          <li>Your email, if you subscribe to the newsletter.</li>
        </ul>
      </section>
      <section>
        <h2>Payments</h2>
        <p>Card, UPI and net-banking details are entered on Razorpay&apos;s secure checkout. They never reach our servers; we only receive the payment status and a reference.</p>
      </section>
      <section>
        <h2>How we use it</h2>
        <p>To process and deliver orders, handle returns and support, send order notifications, and, if you opted in, send the newsletter. We do not sell your personal data.</p>
      </section>
      <section>
        <h2>Who we share it with</h2>
        <p>Only the services needed to run the store: our payment processor, our delivery partners (name, address and phone for the parcel) and our hosting and email providers.</p>
      </section>
      <section>
        <h2>Your choices</h2>
        <ul>
          <li>Update or delete saved addresses and your profile from your <Link href="/account">account</Link>.</li>
          <li>Unsubscribe from the newsletter at any time with the link in every email.</li>
          <li>Ask us to export or delete your data through the <Link href="/contact">contact page</Link>.</li>
        </ul>
      </section>
      <section>
        <h2>Cookies</h2>
        <p>We use essential cookies to keep you signed in and keep your bag. We do not use advertising trackers.</p>
      </section>
    </PolicyShell>
  );
}
