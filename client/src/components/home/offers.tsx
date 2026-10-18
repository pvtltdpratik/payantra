import Link from "next/link";
import { ProductImage } from "@/components/catalogue/product-image";
import { getBanners } from "@/services/home";
import { SectionHeading } from "./section-heading";

/**
 * Limited-time offers: the HOME_STRIP banners an admin has scheduled. The server only returns banners whose
 * window is open, so an offer disappears from here the moment it ends. No offers means no section.
 */
export async function Offers() {
  const offers = (await getBanners("HOME_STRIP")).slice(0, 3);
  if (offers.length === 0) return null;

  return (
    <section className="cv-auto mx-auto max-w-7xl px-4 py-12 sm:py-16" aria-labelledby="offers-h" data-testid="offers">
      <SectionHeading id="offers-h" eyebrow="For a limited time" title="Offers worth a look" />
      <ul className={`grid gap-4 ${offers.length === 1 ? "" : offers.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
        {offers.map((o) => (
          <li key={o.id} data-reveal className="group relative isolate min-h-56 overflow-hidden rounded-2xl bg-primary text-white">
            <ProductImage src={o.imageUrl} alt="" sizes={offers.length === 1 ? "90vw" : "(min-width:768px) 32vw, 90vw"} className="-z-10 transition-transform duration-700 group-hover:scale-105" />
            <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/30 to-black/10" />
            <div className="flex h-full min-h-56 flex-col justify-end p-6">
              <h3 className="font-serif text-2xl font-semibold leading-tight">
                {o.linkUrl ? (
                  <Link href={o.linkUrl} className="after:absolute after:inset-0">
                    {o.title}
                  </Link>
                ) : (
                  o.title
                )}
              </h3>
              {o.subtitle && <p className="mt-1 text-sm text-white/85">{o.subtitle}</p>}
              {o.linkUrl && (
                <span aria-hidden className="mt-3 text-sm font-semibold text-gold">
                  Shop the offer →
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
