import type { Metadata } from "next";
import Link from "next/link";
import { PolicyShell } from "@/components/layout/policy-shell";

export const metadata: Metadata = { title: "Terms of use", description: "The terms that apply when you shop with Payantra." };

/** Plain-language terms matching how the application behaves. Have counsel review before launch. */
export default function TermsPage() {
  return (
    <PolicyShell title="Terms of use" intro="By placing an order you agree to the following.">
      <section>
        <h2>Orders and prices</h2>
        <p>All prices are in Indian rupees and include GST. An order is confirmed when payment succeeds (or, for cash on delivery, when we confirm it). If an item turns out to be unavailable we will tell you and refund anything you paid.</p>
      </section>
      <section>
        <h2>Product information</h2>
        <p>We describe fabrics, colours and measurements as accurately as we can. Handmade pieces vary slightly, and screens show colour differently.</p>
      </section>
      <section>
        <h2>Your account</h2>
        <p>Keep your sign-in details private and tell us if you think someone else has used your account. You are responsible for activity under it.</p>
      </section>
      <section>
        <h2>Returns, shipping and privacy</h2>
        <p>
          These are covered in our <Link href="/returns">returns</Link>, <Link href="/shipping">shipping</Link> and <Link href="/privacy">privacy</Link> pages, which form part of these terms.
        </p>
      </section>
      <section>
        <h2>Reviews</h2>
        <p>Reviews should reflect your own experience. We may remove reviews that are abusive, off-topic or not genuine.</p>
      </section>
      <section>
        <h2>Changes</h2>
        <p>We may update these terms; the version on this page applies to orders placed after the change.</p>
      </section>
    </PolicyShell>
  );
}
