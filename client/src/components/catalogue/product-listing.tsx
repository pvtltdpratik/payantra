import Link from "next/link";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  activeChips,
  hrefWith,
  parseFilters,
  toApiQuery,
  type ListingFilters,
  type RawSearchParams,
} from "@/lib/catalogue-params";
import { getFacets, listProducts } from "@/services/catalogue";
import type { Facets } from "@/types/catalogue";
import { Pagination } from "./pagination";
import { ProductCard } from "./product-card";
import { SortSelect } from "./sort-select";

interface Props {
  basePath: string;
  searchParams: Promise<RawSearchParams>;
  /** Category slug fixed by the route (e.g. /category/silk-sarees). */
  categorySlug?: string;
  /** Shown when no products match. */
  emptyHint?: string;
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

function CheckboxGroup({ legend, name, options, selected }: { legend: string; name: string; options: string[]; selected: string[] }) {
  if (options.length === 0) return null;
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <label
            key={opt}
            className="cursor-pointer rounded-md border border-input bg-card px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:outline-2"
          >
            <input type="checkbox" name={name} value={opt} defaultChecked={selected.includes(opt)} className="sr-only" />
            {opt}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function FilterFields({ filters, facets, clearHref }: { filters: ListingFilters; facets: Facets; clearHref: string }) {
  return (
    <div className="space-y-6">
      {/* Preserve state that has no visible control inside this form. */}
      {filters.q && <input type="hidden" name="q" value={filters.q} />}
      {filters.collection && <input type="hidden" name="collection" value={filters.collection} />}
      {filters.featured && <input type="hidden" name="featured" value="true" />}
      {filters.newArrival && <input type="hidden" name="newArrival" value="true" />}
      <input type="hidden" name="sort" value={filters.sort} />

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">Shop for</legend>
        <div className="flex gap-2">
          {[
            { v: "", l: "All" },
            { v: "WOMEN", l: "Women" },
            { v: "MEN", l: "Men" },
          ].map((g) => (
            <label
              key={g.l}
              className="cursor-pointer rounded-md border border-input bg-card px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:outline-2"
            >
              <input type="radio" name="gender" value={g.v} defaultChecked={(filters.gender ?? "") === g.v} className="sr-only" />
              {g.l}
            </label>
          ))}
        </div>
      </fieldset>

      <CheckboxGroup legend="Size" name="size" options={union(facets.sizes, filters.sizes)} selected={filters.sizes} />
      <CheckboxGroup legend="Colour" name="colour" options={union(facets.colours, filters.colours)} selected={filters.colours} />
      <CheckboxGroup legend="Fabric" name="fabric" options={union(facets.fabrics, filters.fabrics)} selected={filters.fabrics} />

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">Price (₹)</legend>
        <div className="flex items-center gap-2">
          <input
            type="number"
            name="minPrice"
            inputMode="numeric"
            min={0}
            placeholder={facets.price.max ? String(Math.floor(facets.price.min / 100)) : "Min"}
            defaultValue={filters.minRupees}
            aria-label="Minimum price in rupees"
            className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
          />
          <span aria-hidden className="text-muted-foreground">–</span>
          <input
            type="number"
            name="maxPrice"
            inputMode="numeric"
            min={0}
            placeholder={facets.price.max ? String(Math.ceil(facets.price.max / 100)) : "Max"}
            defaultValue={filters.maxRupees}
            aria-label="Maximum price in rupees"
            className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
          />
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">Customer rating</legend>
        <div className="flex flex-wrap gap-2">
          {[
            { v: "", l: "Any" },
            { v: "4", l: "4★ & up" },
            { v: "3", l: "3★ & up" },
          ].map((r) => (
            <label
              key={r.l}
              className="cursor-pointer rounded-md border border-input bg-card px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:outline-2"
            >
              <input type="radio" name="minRating" value={r.v} defaultChecked={String(filters.minRating ?? "") === r.v} className="sr-only" />
              {r.l}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" name="inStock" value="true" defaultChecked={filters.inStock} className="size-4 accent-[var(--primary)]" />
        Show in-stock items only
      </label>

      <div className="flex gap-2 pt-1">
        <Button type="submit" className="flex-1">
          Apply filters
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link href={clearHref} />}>
          Clear
        </Button>
      </div>
    </div>
  );
}

function chipHref(basePath: string, raw: RawSearchParams, key: string, value?: string) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    for (const item of Array.isArray(v) ? v : v ? [v] : []) {
      const parts = ["size", "colour", "fabric"].includes(k) ? item.split(",") : [item];
      for (const part of parts) {
        if (k === key && (value === undefined || part === value)) continue;
        if (k === "page") continue;
        params.append(k, part);
      }
    }
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export async function ProductListing({ basePath, searchParams, categorySlug, emptyHint }: Props) {
  const raw = await searchParams;
  const filters = parseFilters(raw);

  const [{ items, meta }, facets] = await Promise.all([
    listProducts(toApiQuery(filters, { category: categorySlug })),
    getFacets({ q: filters.q, category: categorySlug, gender: filters.gender }),
  ]);

  const chips = activeChips(filters);
  const clearHref = hrefWith(basePath, raw, {
    gender: null, size: null, colour: null, fabric: null, minPrice: null, maxPrice: null,
    inStock: null, minRating: null, featured: null, newArrival: null, collection: null, page: null,
  });

  // Hidden fields so changing the sort keeps every active filter.
  const sortFormFields = Object.entries(raw).flatMap(([k, v]) =>
    k === "sort" || k === "page" ? [] : (Array.isArray(v) ? v : v ? [v] : []).map((val) => [k, val] as const),
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[17rem_1fr]">
      {/* Desktop filters */}
      <aside aria-label="Filters" className="hidden lg:block">
        <form method="get" action={basePath}>
          <FilterFields filters={filters} facets={facets} clearHref={clearHref} />
        </form>
      </aside>

      <section aria-label="Products">
        {/* Mobile filters */}
        <details className="mb-4 rounded-md border bg-card lg:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
            <SlidersHorizontal aria-hidden className="size-4" />
            Filters{chips.length ? ` (${chips.length})` : ""}
          </summary>
          <form method="get" action={basePath} className="border-t p-4">
            <FilterFields filters={filters} facets={facets} clearHref={clearHref} />
          </form>
        </details>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {meta.total === 0 ? "No products" : `${meta.total} product${meta.total === 1 ? "" : "s"}`}
          </p>
          <form method="get" action={basePath} className="flex items-center gap-2">
            {sortFormFields.map(([k, v], i) => (
              <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
            ))}
            <SortSelect value={filters.sort} />
            <noscript>
              <Button type="submit" size="sm" variant="outline">
                Sort
              </Button>
            </noscript>
          </form>
        </div>

        {chips.length > 0 && (
          <ul aria-label="Applied filters" className="mb-6 flex flex-wrap gap-2">
            {chips.map((c, i) => (
              <li key={`${c.key}-${c.value ?? i}`}>
                <Link
                  href={chipHref(basePath, raw, c.key, c.value)}
                  className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs hover:border-primary"
                >
                  {c.label}
                  <X aria-hidden className="size-3" />
                  <span className="sr-only">Remove filter</span>
                </Link>
              </li>
            ))}
            <li>
              <Link href={clearHref} className="inline-block px-2 py-1 text-xs text-primary underline">
                Clear all
              </Link>
            </li>
          </ul>
        )}

        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card px-6 py-16 text-center">
            <h2 className="font-serif text-2xl">Nothing matches just yet</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              {emptyHint ?? "Try removing a filter or searching for something broader."}
            </p>
            {chips.length > 0 && (
              <Button className="mt-6" nativeButton={false} render={<Link href={clearHref} />}>
                Clear all filters
              </Button>
            )}
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 xl:grid-cols-4">
            {items.map((p, i) => (
              <li key={p.id}>
                <ProductCard product={p} priority={i < 4} />
              </li>
            ))}
          </ul>
        )}

        <Pagination basePath={basePath} searchParams={raw} page={meta.page} totalPages={meta.totalPages} />
      </section>
    </div>
  );
}
