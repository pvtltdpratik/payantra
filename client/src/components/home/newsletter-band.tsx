import { NewsletterForm } from "@/components/layout/newsletter-form";

/** A full-width invitation on the home page; the same endpoint and form as the footer's. */
export function NewsletterBand() {
  return (
    <section className="cv-auto woven bg-primary text-primary-foreground" aria-labelledby="newsletter-h" data-testid="newsletter-band">
      <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-14 sm:py-20 md:grid-cols-2">
        <div data-reveal>
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.3em] text-gold">The Payantra letter</p>
          <h2 id="newsletter-h" className="text-3xl font-semibold sm:text-4xl">
            First to know, first to wear
          </h2>
          <p className="mt-3 max-w-md text-primary-foreground/80">New collections, festive edits and the occasional offer, sent rarely and never shared.</p>
        </div>
        <div data-reveal>
          <NewsletterForm id="newsletter-band-email" label="Your email address" />
        </div>
      </div>
    </section>
  );
}
