import { REVEAL } from "@/lib/motion";
import Link from "next/link";
import { ProductImage } from "@/components/catalogue/product-image";
import { SpotlightCard } from "@/components/reactbits";
import { getCategoryTreeSafe } from "@/services/catalogue";
import { SectionHeading } from "./section-heading";

/** Brand-palette fallbacks for categories that have no photograph yet (the /placeholder route draws the artwork). */
const PALETTE = ["5c1a2b", "7a2338", "1f5c4a", "2b3a67", "8d6a2b", "3b1220", "a8344f", "4d5a2e"];

/**
 * "Shop by category": the top-level categories an admin has made, with how many products each holds.
 * Nothing is hard-coded: add, rename or hide a category in the admin and this changes with it.
 */
export async function CategoryTiles() {
  const categories = (await getCategoryTreeSafe()).filter((c) => c.productCount > 0).slice(0, 8);
  if (categories.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:py-16" aria-labelledby="categories-h" data-testid="category-tiles">
      <SectionHeading id="categories-h" eyebrow="Shop by category" title="Find your silhouette" href="/shop" linkLabel="All products" />
      <ul className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-4">
        {categories.map((c, i) => (
          <li key={c.id} {...REVEAL}>
            <SpotlightCard theme="light" spotlightColor="#c8a45d" intensity={0.35} spotlightSize={260} className="p-0! rounded-2xl!">
              <div className="relative aspect-[4/5] overflow-hidden bg-muted">
                <ProductImage
                  src={c.imageUrl ?? `/placeholder/${PALETTE[i % PALETTE.length]}?label=${encodeURIComponent(c.name)}&v=${(i % 3) + 1}`}
                  alt=""
                  sizes="(min-width:768px) 22vw, 46vw"
                  className="transition-transform duration-700 group-hover/tile:scale-105"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent p-4 pt-14 text-white">
                  <h3 className="font-serif text-xl font-semibold leading-tight sm:text-2xl">
                    <Link href={`/category/${c.slug}`} className="after:absolute after:inset-0 focus-visible:outline-2">
                      {c.name}
                    </Link>
                  </h3>
                  <p className="mt-0.5 text-xs text-white/80">
                    {c.productCount} piece{c.productCount === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            </SpotlightCard>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Same padding, heading height and grid as the real section (up to eight tiles), so its arrival moves nothing. */
export const CategoryTilesSkeleton = () => (
  <div className="mx-auto max-w-7xl px-4 py-12 sm:py-16" aria-hidden>
    <div className="mb-8">
      <div className="mb-2 h-4 w-32 rounded bg-muted" />
      <div className="h-9 w-64 max-w-full rounded bg-muted sm:h-10" />
    </div>
    <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="aspect-[4/5] rounded-2xl bg-muted" />
      ))}
    </div>
  </div>
);
