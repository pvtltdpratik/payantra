import { BadgeCheck } from "lucide-react";
import { getProductReviews } from "@/services/reviews";
import { ReviewPrompt } from "./review-prompt";
import { Stars } from "./stars";

/** Customer reviews for a product page: the summary, the newest reviews, and (for eligible buyers) a form. */
export async function ProductReviews({ slug, productId }: { slug: string; productId: string }) {
  const data = await getProductReviews(slug);
  const s = data?.summary;
  const max = s ? Math.max(1, ...Object.values(s.histogram)) : 1;

  return (
    <section aria-labelledby="reviews-h" className="mt-16 border-t pt-10" data-testid="reviews-section">
      <h2 id="reviews-h" className="text-3xl font-semibold">
        Customer reviews
      </h2>

      {!data || data.summary.count === 0 ? (
        <p className="mt-3 text-muted-foreground" data-testid="no-reviews">
          No reviews yet. Buy this piece and be the first to tell others how it wears.
        </p>
      ) : (
        <div className="mt-6 grid gap-10 lg:grid-cols-[18rem_1fr]">
          <div>
            <p className="flex items-end gap-2">
              <span className="text-5xl font-semibold tabular-nums" data-testid="reviews-average">
                {data.summary.average.toFixed(1)}
              </span>
              <span className="pb-1.5 text-sm text-muted-foreground">out of 5</span>
            </p>
            <Stars value={data.summary.average} className="mt-1" />
            <p className="mt-1 text-sm text-muted-foreground" data-testid="reviews-count">
              {data.summary.count} review{data.summary.count === 1 ? "" : "s"}
            </p>
            <ul className="mt-4 space-y-1.5 text-sm" aria-label="Ratings breakdown">
              {([5, 4, 3, 2, 1] as const).map((n) => (
                <li key={n} className="flex items-center gap-2">
                  <span className="w-12 text-muted-foreground">{n} star{n === 1 ? "" : "s"}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="block h-full bg-gold" style={{ width: `${(data.summary.histogram[n] / max) * 100}%` }} />
                  </span>
                  <span className="w-6 text-right tabular-nums text-muted-foreground">{data.summary.histogram[n]}</span>
                </li>
              ))}
            </ul>
          </div>

          <ul className="divide-y">
            {data.items.map((r) => (
              <li key={r.id} className="py-5 first:pt-0" data-testid="review">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Stars value={r.rating} />
                  {r.title && <h3 className="font-sans text-base font-semibold">{r.title}</h3>}
                </div>
                {r.body && <p className="mt-2 whitespace-pre-line leading-relaxed text-muted-foreground">{r.body}</p>}
                <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{r.reviewer}</span>
                  {r.verifiedPurchase && (
                    <span className="inline-flex items-center gap-1 text-success">
                      <BadgeCheck aria-hidden className="size-3.5" /> Verified purchase
                    </span>
                  )}
                  <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" })}</time>
                </p>
              </li>
            ))}
            {data.total > data.items.length && <li className="pt-4 text-sm text-muted-foreground">Showing the {data.items.length} most recent of {data.total} reviews.</li>}
          </ul>
        </div>
      )}

      <ReviewPrompt productId={productId} />
    </section>
  );
}
