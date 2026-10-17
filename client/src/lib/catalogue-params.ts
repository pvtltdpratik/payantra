import type { ProductSort } from "@/types/catalogue";

export type RawSearchParams = Record<string, string | string[] | undefined>;

const SORTS: ProductSort[] = ["newest", "price_asc", "price_desc", "popularity", "rating"];

export const SORT_LABELS: Record<ProductSort, string> = {
  newest: "Newest first",
  popularity: "Most popular",
  rating: "Highest rated",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function many(v: string | string[] | undefined): string[] {
  const raw = Array.isArray(v) ? v : v ? [v] : [];
  return raw.flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
}

function positiveInt(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/**
 * Normalised, UI-facing filter state parsed from the URL.
 * Prices are whole rupees here (what shoppers type) and converted to paise for the API.
 */
export interface ListingFilters {
  q?: string;
  gender?: "WOMEN" | "MEN" | "UNISEX";
  collection?: string;
  sizes: string[];
  colours: string[];
  fabrics: string[];
  minRupees?: number;
  maxRupees?: number;
  inStock: boolean;
  minRating?: number;
  featured: boolean;
  newArrival: boolean;
  sort: ProductSort;
  page: number;
}

export function parseFilters(sp: RawSearchParams): ListingFilters {
  const gender = first(sp.gender);
  const sort = first(sp.sort) as ProductSort | undefined;
  const rating = Number(first(sp.minRating));
  const page = positiveInt(first(sp.page));
  return {
    q: first(sp.q)?.trim().slice(0, 100) || undefined,
    gender: gender === "WOMEN" || gender === "MEN" || gender === "UNISEX" ? gender : undefined,
    collection: first(sp.collection)?.trim() || undefined,
    sizes: many(sp.size),
    colours: many(sp.colour),
    fabrics: many(sp.fabric),
    minRupees: positiveInt(first(sp.minPrice)),
    maxRupees: positiveInt(first(sp.maxPrice)),
    inStock: first(sp.inStock) === "true",
    minRating: rating >= 1 && rating <= 5 ? rating : undefined,
    featured: first(sp.featured) === "true",
    newArrival: first(sp.newArrival) === "true",
    sort: sort && SORTS.includes(sort) ? sort : "newest",
    page: page && page > 0 ? page : 1,
  };
}

/** Query string for the API (prices converted to paise). */
export function toApiQuery(f: ListingFilters, extra: { category?: string; pageSize?: number } = {}) {
  const minPrice = f.minRupees !== undefined ? f.minRupees * 100 : undefined;
  const maxPrice = f.maxRupees !== undefined ? f.maxRupees * 100 : undefined;
  // An inverted range would be a 400; swap instead so a typo still shows results.
  const [lo, hi] = minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice ? [maxPrice, minPrice] : [minPrice, maxPrice];
  return {
    q: f.q,
    category: extra.category,
    collection: f.collection,
    gender: f.gender,
    size: f.sizes.join(",") || undefined,
    colour: f.colours.join(",") || undefined,
    fabric: f.fabrics.join(",") || undefined,
    minPrice: lo,
    maxPrice: hi,
    inStock: f.inStock ? "true" : undefined,
    minRating: f.minRating,
    featured: f.featured ? "true" : undefined,
    newArrival: f.newArrival ? "true" : undefined,
    sort: f.sort,
    page: f.page,
    pageSize: extra.pageSize ?? 24,
  };
}

/** Builds a link that keeps the current filters but overrides some values. */
export function hrefWith(
  basePath: string,
  current: RawSearchParams,
  overrides: Record<string, string | number | undefined | null>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (key in overrides) continue;
    for (const v of Array.isArray(value) ? value : value ? [value] : []) params.append(key, v);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Active filters as removable chips, for the "applied filters" row. */
export function activeChips(f: ListingFilters): { key: string; value?: string; label: string }[] {
  const chips: { key: string; value?: string; label: string }[] = [];
  if (f.gender) chips.push({ key: "gender", label: f.gender === "WOMEN" ? "Women" : f.gender === "MEN" ? "Men" : "Unisex" });
  f.sizes.forEach((s) => chips.push({ key: "size", value: s, label: `Size ${s}` }));
  f.colours.forEach((c) => chips.push({ key: "colour", value: c, label: c }));
  f.fabrics.forEach((c) => chips.push({ key: "fabric", value: c, label: c }));
  if (f.minRupees !== undefined) chips.push({ key: "minPrice", label: `From ₹${f.minRupees.toLocaleString("en-IN")}` });
  if (f.maxRupees !== undefined) chips.push({ key: "maxPrice", label: `Up to ₹${f.maxRupees.toLocaleString("en-IN")}` });
  if (f.inStock) chips.push({ key: "inStock", label: "In stock" });
  if (f.minRating) chips.push({ key: "minRating", label: `${f.minRating}★ & up` });
  if (f.featured) chips.push({ key: "featured", label: "Featured" });
  if (f.newArrival) chips.push({ key: "newArrival", label: "New arrivals" });
  if (f.collection) chips.push({ key: "collection", label: `Collection: ${f.collection.replace(/-/g, " ")}` });
  return chips;
}
