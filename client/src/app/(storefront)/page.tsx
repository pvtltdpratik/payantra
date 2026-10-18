import { Suspense } from "react";
import { connection } from "next/server";
import { BrandStory } from "@/components/home/brand-story";
import { CategoryTiles, CategoryTilesSkeleton } from "@/components/home/category-tiles";
import { CraftStory } from "@/components/home/craft-story";
import { CustomerReviews } from "@/components/home/customer-reviews";
import { GenderPanels } from "@/components/home/gender-panels";
import { Hero } from "@/components/home/hero";
import { NewsletterBand } from "@/components/home/newsletter-band";
import { Offers } from "@/components/home/offers";
import { ProductRow, RowSkeleton } from "@/components/home/product-row";
import { SeasonalCollections } from "@/components/home/seasonal-collections";
import { StyleGallery } from "@/components/home/style-gallery";
import { TrustBar, TrustBarSkeleton } from "@/components/home/trust-bar";
import { api, ApiError, isFrameworkSignal } from "@/lib/api";

/** Renders only when something is wrong, so shoppers never see developer chrome. */
async function SystemNotice() {
  await connection();
  try {
    await api("/health/ready", { cache: "no-store" });
    return null;
  } catch (err) {
    if (isFrameworkSignal(err)) throw err;
    const dbDown = err instanceof ApiError && err.status === 503;
    return (
      <p role="status" className="mx-auto mt-8 max-w-md rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-center text-sm text-destructive">
        {dbDown ? "The API is running but its database is unreachable — check DATABASE_URL." : "The API is unreachable — start the server on port 4000."}
      </p>
    );
  }
}

/**
 * The landing page. The hero is static HTML (headline, copy, buttons, SVG art) that is complete before any script
 * runs; every other section is read live from the API, streams in on its own, reserves its space with a skeleton, and
 * removes itself when there is nothing to show (no fake products, offers or reviews).
 */
export default function Home() {
  return (
    <>
      <Hero />
      <Suspense fallback={<TrustBarSkeleton />}>
        <TrustBar />
      </Suspense>
      <Suspense fallback={null}>
        <SystemNotice />
      </Suspense>

      <Suspense fallback={<CategoryTilesSkeleton />}>
        <CategoryTiles />
      </Suspense>
      <Suspense fallback={<RowSkeleton />}>
        <ProductRow
          id="featured-sarees"
          eyebrow="Featured sarees"
          title="Drape something timeless"
          href="/category/sarees"
          query={{ category: "sarees", featured: "true", sort: "popularity" }}
          fallbackQuery={{ featured: "true", sort: "popularity" }}
        />
      </Suspense>
      <Suspense fallback={<RowSkeleton />}>
        <ProductRow id="new-arrivals" eyebrow="Just in" title="New arrivals" href="/shop?newArrival=true" query={{ newArrival: "true", sort: "newest" }} fallbackQuery={{ sort: "newest" }} />
      </Suspense>
      <Suspense fallback={<RowSkeleton />}>
        <ProductRow id="best-sellers" eyebrow="Most loved" title="Best sellers" href="/shop?sort=popularity" query={{ sort: "popularity" }} />
      </Suspense>

      <Suspense fallback={null}>
        <GenderPanels />
      </Suspense>
      <CraftStory />
      <Suspense fallback={null}>
        <SeasonalCollections />
      </Suspense>
      <Suspense fallback={null}>
        <Offers />
      </Suspense>
      <Suspense fallback={null}>
        <CustomerReviews />
      </Suspense>
      <BrandStory />
      <Suspense fallback={null}>
        <StyleGallery />
      </Suspense>
      <NewsletterBand />
    </>
  );
}
