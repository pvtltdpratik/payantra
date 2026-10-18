import Link from "next/link";
import { Button } from "@/components/ui/button";

/** The "Discover Our Story" target. Plain, fully server-rendered copy: it describes the brand, not the catalogue. */
export function BrandStory() {
  return (
    <section id="story" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-16 sm:py-24" aria-labelledby="story-h" data-testid="brand-story">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-20">
        <div data-reveal>
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.3em] text-[#8a6a2b]">Our story</p>
          <h2 id="story-h" className="text-4xl font-semibold leading-tight text-primary sm:text-5xl">
            Payantra means <span className="text-[#8a6a2b]">a journey</span>
          </h2>
          <div className="mt-6 space-y-4 text-muted-foreground">
            <p>
              We started Payantra to make it easier to wear India&apos;s textile heritage. Not as costume, but as clothes you reach for: a saree you can drape in minutes, a kurta that works from office to wedding.
            </p>
            <p>
              Every piece is chosen for the hands and traditions behind it, then described honestly, with the fabric, the fit and the care it needs, so what arrives is what you expected.
            </p>
          </div>
          <Button className="mt-8" variant="outline" size="lg" nativeButton={false} render={<Link href="/shop?newArrival=true" />}>
            See what&apos;s new
          </Button>
        </div>

        <dl className="grid grid-cols-2 gap-4" data-reveal>
          {[
            ["Honest descriptions", "Fabric, fit and care, spelled out on every product page."],
            ["Considered sourcing", "Pieces chosen for the craft and the people behind them."],
            ["Easy returns", "A clear return window and a straightforward process."],
            ["Made to last", "Fabrics and finishes picked to be worn for years."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border bg-card p-5">
              <dt className="font-serif text-lg font-semibold text-primary">{t}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
