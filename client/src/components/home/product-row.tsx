import { connection } from "next/server";
import { ProductCard } from "@/components/catalogue/product-card";
import { Skeleton } from "@/components/ui/skeleton";
import { isFrameworkSignal } from "@/lib/api";
import { listProducts } from "@/services/catalogue";
import { SectionHeading } from "./section-heading";

type Query = Record<string, string | number>;

/**
 * A row of live products. `fallbackQuery` is tried when the first query finds nothing (for example "featured sarees"
 * before anything is marked featured), and a row with nothing to show is left out entirely rather than shown empty.
 */
export async function ProductRow({ id, eyebrow, title, href, query, fallbackQuery, count = 4 }: { id: string; eyebrow?: string; title: string; href: string; query: Query; fallbackQuery?: Query; count?: number }) {
  await connection();
  let items: Awaited<ReturnType<typeof listProducts>>["items"] = [];
  try {
    items = (await listProducts({ ...query, pageSize: count })).items;
    if (items.length === 0 && fallbackQuery) items = (await listProducts({ ...fallbackQuery, pageSize: count })).items;
  } catch (err) {
    if (isFrameworkSignal(err)) throw err;
    return null; // a failed row must never take the home page down
  }
  if (items.length === 0) return null;

  return (
    <section className="cv-auto mx-auto max-w-7xl px-4 py-12 sm:py-16" aria-labelledby={id} data-testid={`row-${id}`}>
      <SectionHeading id={id} eyebrow={eyebrow} title={title} href={href} />
      <ul className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4">
        {items.map((p) => (
          <li key={p.id} data-reveal>
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Reserves the row's height while it loads, so nothing below it moves when it arrives. */
export const RowSkeleton = () => (
  <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 py-16 lg:grid-cols-4" aria-hidden>
    {Array.from({ length: 4 }, (_, i) => (
      <Skeleton key={i} className="aspect-[4/5]" />
    ))}
  </div>
);
