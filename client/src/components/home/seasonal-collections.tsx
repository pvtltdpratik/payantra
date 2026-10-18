import Link from "next/link";
import { ProductImage } from "@/components/catalogue/product-image";
import { getCollections } from "@/services/home";
import { SectionHeading } from "./section-heading";

const PALETTE = ["7a2338", "1f5c4a", "8d6a2b", "2b3a67", "5c1a2b", "a8344f"];

/** Festive and seasonal edits: the active collections an admin curates, seasonal ones first. */
export async function SeasonalCollections() {
  const all = await getCollections();
  const list = [...all].sort((a, b) => Number(b.isSeasonal) - Number(a.isSeasonal)).slice(0, 4);
  if (list.length === 0) return null;

  return (
    <section className="cv-auto bg-secondary/50 py-12 sm:py-16" aria-labelledby="seasonal-h" data-testid="seasonal">
      <div className="mx-auto max-w-7xl px-4">
        <SectionHeading id="seasonal-h" eyebrow="Festive & seasonal" title="Edits for the season" href="/shop" linkLabel="Shop everything" />
        <ul className="grid gap-4 sm:grid-cols-2">
          {list.map((c, i) => (
            <li key={c.id} data-reveal className="group relative isolate aspect-[16/10] overflow-hidden rounded-2xl bg-primary text-white">
              <ProductImage
                src={c.imageUrl ?? `/placeholder/${PALETTE[i % PALETTE.length]}?label=${encodeURIComponent(c.name)}&v=${(i % 3) + 1}`}
                alt=""
                sizes="(min-width:640px) 45vw, 92vw"
                className="-z-10 transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
              <div className="flex h-full flex-col justify-end p-6">
                {c.isSeasonal && <p className="mb-1 text-[0.65rem] font-medium uppercase tracking-[0.3em] text-gold">Seasonal</p>}
                <h3 className="font-serif text-2xl font-semibold sm:text-3xl">
                  <Link href={`/shop?collection=${encodeURIComponent(c.slug)}`} className="after:absolute after:inset-0">
                    {c.name}
                  </Link>
                </h3>
                {c.description && <p className="mt-1 line-clamp-2 max-w-md text-sm text-white/85">{c.description}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
