import { REVEAL } from "@/lib/motion";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getCategoryTreeSafe } from "@/services/catalogue";
import { SectionHeading } from "./section-heading";

const PANELS = [
  { gender: "WOMEN", label: "Women", blurb: "Sarees, lehengas, kurtis and the jewellery to finish the look.", href: "/shop?gender=WOMEN", tone: "bg-[#4a1624] text-primary-foreground" },
  { gender: "MEN", label: "Men", blurb: "Kurtas, Nehru jackets and sherwanis, cut for celebration and for every day.", href: "/shop?gender=MEN", tone: "bg-[#ece0c8] text-foreground" },
] as const;

/** Two large panels into the women's and men's collections, each listing its real top categories. */
export async function GenderPanels() {
  const tree = await getCategoryTreeSafe();
  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:py-16" aria-labelledby="collections-h" data-testid="gender-panels">
      <SectionHeading id="collections-h" eyebrow="Collections" title="For her, for him" />
      <div className="grid gap-4 md:grid-cols-2">
        {PANELS.map((p) => {
          const dark = p.gender === "WOMEN";
          const cats = tree.filter((c) => c.gender === p.gender && c.productCount > 0).slice(0, 5);
          return (
            <article key={p.gender} {...REVEAL} className={`woven relative isolate overflow-hidden rounded-3xl p-8 sm:p-12 ${p.tone}`}>
              <div aria-hidden className="absolute -right-16 -top-16 size-64 rounded-full border border-gold/50" />
              <div aria-hidden className="absolute -right-6 -top-6 size-64 rounded-full border border-gold/30" />
              <h3 className="font-serif text-4xl font-semibold sm:text-5xl">
                <Link href={p.href} className="after:absolute after:inset-0 focus-visible:outline-2" data-testid={`panel-${p.gender.toLowerCase()}`}>
                  {p.label}
                </Link>
              </h3>
              <p className={`mt-3 max-w-sm text-sm sm:text-base ${dark ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{p.blurb}</p>
              {cats.length > 0 && (
                <ul className="mt-6 flex flex-wrap gap-2" aria-label={`${p.label}'s categories`}>
                  {cats.map((c) => (
                    <li key={c.id} className={`rounded-full border px-3 py-1 text-xs ${dark ? "border-white/25 text-white/90" : "border-foreground/20"}`}>
                      {c.name}
                    </li>
                  ))}
                </ul>
              )}
              <span className={`mt-8 inline-flex items-center gap-2 text-sm font-semibold ${dark ? "text-gold" : "text-primary"}`}>
                Shop {p.label.toLowerCase()}
                <ArrowRight aria-hidden className="size-4" />
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}
