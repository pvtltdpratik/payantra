import Link from "next/link";
import { connection } from "next/server";
import { ProductImage } from "@/components/catalogue/product-image";
import { isFrameworkSignal } from "@/lib/api";
import { listProducts } from "@/services/catalogue";
import { SectionHeading } from "./section-heading";

const SHAPES = ["aspect-[3/4]", "aspect-square", "aspect-[4/5]", "aspect-[3/4]", "aspect-[4/5]", "aspect-square", "aspect-[3/4]", "aspect-[4/5]"];

/**
 * A social-style gallery built from the newest products' own photography. Each tile links to the product; no
 * outside feed is embedded, so there is no third-party script, tracking or layout shift.
 */
export async function StyleGallery() {
  await connection();
  let items: Awaited<ReturnType<typeof listProducts>>["items"] = [];
  try {
    items = (await listProducts({ sort: "newest", pageSize: 8 })).items.filter((p) => p.image);
  } catch (err) {
    if (isFrameworkSignal(err)) throw err;
    return null;
  }
  if (items.length < 4) return null;

  return (
    <section className="cv-auto mx-auto max-w-7xl px-4 py-12 sm:py-16" aria-labelledby="gallery-h" data-testid="style-gallery">
      <SectionHeading id="gallery-h" eyebrow="The lookbook" title="Fresh looks, just in" href="/shop?sort=newest" linkLabel="Shop the looks" />
      <ul className="columns-2 gap-3 sm:gap-4 md:columns-4 [&>li]:mb-3 sm:[&>li]:mb-4">
        {items.map((p, i) => (
          <li key={p.id} data-reveal className="break-inside-avoid">
            <Link href={`/product/${p.slug}`} className={`group relative block overflow-hidden rounded-xl bg-muted ${SHAPES[i % SHAPES.length]}`}>
              <ProductImage src={p.image!.url} alt={p.image!.alt ?? p.name} sizes="(min-width:768px) 24vw, 46vw" className="transition-transform duration-700 group-hover:scale-105" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent p-3 pt-10 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                {p.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
