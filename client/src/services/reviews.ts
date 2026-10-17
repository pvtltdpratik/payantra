import { api, isFrameworkSignal } from "@/lib/api";
import type { ProductReviews, PublicReview, ReviewSummary } from "@/types/reviews";

/**
 * A product's public reviews, fetched live.
 *
 * Unlike the catalogue these are NOT cached: a customer who has just posted a review, or an admin who has just
 * hidden one, must see the page change immediately. The request is small and sits inside the product page's
 * Suspense boundary, so the rest of the page is not held up. A failure leaves the section empty.
 */
export async function getProductReviews(slug: string): Promise<ProductReviews | null> {
  try {
    const { data, meta } = await api<{ summary: ReviewSummary; items: PublicReview[] }>(`/reviews/product/${encodeURIComponent(slug)}`, {
      query: { pageSize: 10 },
      cache: "no-store",
    });
    return { summary: data.summary, items: data.items, total: Number((meta as { total?: number } | undefined)?.total ?? data.items.length) };
  } catch (err) {
    if (isFrameworkSignal(err)) throw err;
    console.error("[reviews] could not load reviews for", slug, err);
    return null;
  }
}
