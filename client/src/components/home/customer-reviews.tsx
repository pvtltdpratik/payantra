import Link from "next/link";
import { Star } from "lucide-react";
import { getFeaturedReviews } from "@/services/home";
import { SectionHeading } from "./section-heading";

function Stars({ value }: { value: number }) {
  return (
    <p className="flex items-center gap-0.5" role="img" aria-label={`Rated ${value} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} aria-hidden className={`size-4 ${i < value ? "fill-gold text-gold" : "text-border"}`} />
      ))}
    </p>
  );
}

/**
 * What customers said: real, visible reviews of 4 stars or more (one per product), chosen by the server. This is
 * never padded with sample quotes; with no qualifying reviews the section is left out.
 */
export async function CustomerReviews() {
  const reviews = (await getFeaturedReviews()).slice(0, 6);
  if (reviews.length === 0) return null;

  return (
    <section className="cv-auto mx-auto max-w-7xl px-4 py-12 sm:py-16" aria-labelledby="reviews-h" data-testid="home-reviews">
      <SectionHeading id="reviews-h" eyebrow="Kind words" title="Loved by our customers" />
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {reviews.map((r) => (
          <li key={r.id} data-reveal>
            <figure className="flex h-full flex-col rounded-2xl border bg-card p-6">
              <Stars value={r.rating} />
              {r.title && <p className="mt-3 font-serif text-lg font-semibold">{r.title}</p>}
              <blockquote className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{r.body}</blockquote>
              <figcaption className="mt-4 text-sm">
                <span className="font-medium">{r.reviewer}</span>
                <span className="text-muted-foreground"> on </span>
                <Link href={`/product/${r.productSlug}`} className="text-primary underline-offset-4 hover:underline">
                  {r.productName}
                </Link>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
