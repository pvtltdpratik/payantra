import { REVEAL } from "@/lib/motion";
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
    <section className="mx-auto max-w-7xl px-4 py-12 sm:py-16" aria-labelledby={id} data-testid={`row-${id}`}>
      <SectionHeading id={id} eyebrow={eyebrow} title={title} href={href} />
      <ul className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4">
        {items.map((p) => (
          <li key={p.id} {...REVEAL}>
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Reserves the row's height while it loads, so nothing below it moves when it arrives. It mirrors the real row's
 * markup: same padding, a heading of the same height (eyebrow 16 px + 8, title 36/40 px + 32), the same grid, and a
 * text block under every image as tall as a product card's (about 118 px). On a slow connection the real row streams
 * in while it is on screen, and a skeleton that is shorter than the row would push everything below it down.
 */
export const RowSkeleton = () => (
  <div className="mx-auto max-w-7xl px-4 py-12 sm:py-16" aria-hidden>
    <div className="mb-8">
      <Skeleton className="mb-2 h-4 w-28" />
      <Skeleton className="h-9 w-72 max-w-full sm:h-10" />
    </div>
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[4/5]" />
          <div className="mt-3 h-[7.375rem]" />
        </div>
      ))}
    </div>
  </div>
);
