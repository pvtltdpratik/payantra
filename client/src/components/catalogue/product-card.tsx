import Link from "next/link";
import type { ProductCardData } from "@/types/catalogue";
import { Price } from "./price";
import { ProductImage } from "./product-image";
import { Rating } from "./rating";
import { WishlistButton } from "./wishlist-button";

const CARD_SIZES = "(min-width:1280px) 22vw, (min-width:1024px) 30vw, (min-width:640px) 45vw, 90vw";

export function ProductCard({ product, priority = false }: { product: ProductCardData; priority?: boolean }) {
  const p = product;
  return (
    <article className="group relative">
      {/* A sibling of the link, overlaid on the image: a button must not live inside an <a>. */}
      <div className="absolute right-2 top-2 z-10">
        <WishlistButton productId={p.id} productName={p.name} />
      </div>
      <Link
        href={`/product/${p.slug}`}
        className="block rounded-md focus-visible:outline-2"
        aria-label={`${p.name}, ${p.inStock ? "in stock" : "sold out"}`}
      >
        <div className="relative aspect-[4/5] overflow-hidden rounded-md bg-muted">
          {p.image ? (
            <ProductImage
              src={p.image.url}
              alt={p.image.alt ?? p.name}
              sizes={CARD_SIZES}
              priority={priority}
              className="transition-opacity duration-500 group-hover:opacity-0"
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">No image</div>
          )}
          {p.hoverImage && (
            <ProductImage
              src={p.hoverImage.url}
              alt=""
              sizes={CARD_SIZES}
              className="opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            />
          )}

          <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {p.isNewArrival && (
              <span className="rounded-sm bg-primary px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-primary-foreground">
                New
              </span>
            )}
            {p.discountPercent > 0 && (
              <span className="rounded-sm bg-gold px-2 py-0.5 text-[11px] font-semibold text-gold-foreground">
                {p.discountPercent}% off
              </span>
            )}
          </div>

          {!p.inStock && (
            <div className="absolute inset-x-0 bottom-0 bg-foreground/80 py-1.5 text-center text-xs font-medium uppercase tracking-widest text-background">
              Sold out
            </div>
          )}
        </div>

        <div className="mt-3 space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{p.category.name}</p>
          <h3 className="line-clamp-2 font-serif text-lg font-semibold leading-snug group-hover:text-primary">
            {p.name}
          </h3>
          <Price price={p.price} basePrice={p.basePrice} salePrice={p.salePrice} />
          <div className="flex items-center justify-between gap-2">
            <Rating value={p.ratingAverage} count={p.ratingCount} />
            {p.colours.length > 1 && (
              <p className="text-xs text-muted-foreground">{p.colours.length} colours</p>
            )}
          </div>
        </div>
      </Link>
    </article>
  );
}
