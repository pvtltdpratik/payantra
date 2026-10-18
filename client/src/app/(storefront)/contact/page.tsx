import type { Metadata } from "next";
import Link from "next/link";
import { PolicyShell } from "@/components/layout/policy-shell";
import { contact, socials, telHref } from "@/lib/site";

export const metadata: Metadata = { title: "Contact us", description: "Ways to reach the Payantra team." };

export default function ContactPage() {
  const any = contact.email || contact.phone || socials.length > 0;
  return (
    <PolicyShell title="Contact us" intro="We're glad to help with an order, a fit question or a styling idea.">
      <section>
        <h2>Order help</h2>
        <p>
          The fastest way to get help with an order is a support request from your account: it stays linked to the order and you are notified when we reply. <Link href="/account/support">Open a request</Link>.
        </p>
      </section>
      {any && (
        <section data-testid="contact-details">
          <h2>Get in touch</h2>
          <ul>
            {contact.email && (
              <li>
                Email: <a href={`mailto:${contact.email}`}>{contact.email}</a>
              </li>
            )}
            {contact.phone && (
              <li>
                Phone: <a href={telHref(contact.phone)}>{contact.phone}</a>
              </li>
            )}
            {contact.hours && <li>Hours: {contact.hours}</li>}
            {socials.map((s) => (
              <li key={s.key}>
                {s.label}:{" "}
                <a href={s.href} target="_blank" rel="noopener noreferrer">
                  {s.href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PolicyShell>
  );
}
