import { cacheLife } from "next/cache";
import { api, ApiError, isFrameworkSignal } from "@/lib/api";
import type {
  CategoryDetail,
  CategoryNode,
  Facets,
  PageMeta,
  ProductCardData,
  ProductDetailData,
} from "@/types/catalogue";

type Query = Record<string, string | number | boolean | undefined | null>;

export interface ProductPage {
  items: ProductCardData[];
  meta: PageMeta;
}

const EMPTY_PAGE: PageMeta = { page: 1, pageSize: 24, total: 0, totalPages: 1 };

type TreeResult = { ok: true; data: CategoryNode[] } | { ok: false };

/**
 * Category tree changes rarely; cache it so the header never blocks on the API.
 *
 * This function must NEVER throw: an error escaping a `"use cache"` scope is claimed by Next's
 * prerender and fails the whole build (e.g. in CI, where no API is running). Failures are returned
 * as a value instead.
 *
 * Do NOT shorten the lifetime on the failure path: a very short `cacheLife` makes the entry
 * runtime-dynamic and then demands a <Suspense> boundary around every consumer. The `minutes`
 * profile already revalidates in the background after a minute, so an outage heals on its own.
 */
async function loadCategoryTree(): Promise<TreeResult> {
  "use cache";
  cacheLife("minutes");
  try {
    const { data } = await api<CategoryNode[]>("/categories");
    return { ok: true, data };
  } catch (err) {
    if (isFrameworkSignal(err)) throw err;
    console.error("[catalogue] category tree request failed:", err);
    return { ok: false };
  }
}

/** Chrome (header, footer, menus) should degrade, not crash the page. */
export async function getCategoryTreeSafe(): Promise<CategoryNode[]> {
  const result = await loadCategoryTree();
  return result.ok ? result.data : [];
}

export async function listProducts(query: Query): Promise<ProductPage> {
  try {
    const { data, meta } = await api<ProductCardData[]>("/products", { query, cache: "no-store" });
    return { items: data, meta: (meta as unknown as PageMeta) ?? EMPTY_PAGE };
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) return { items: [], meta: EMPTY_PAGE };
    throw err;
  }
}

export async function getFacets(query: { q?: string; category?: string; gender?: string }): Promise<Facets> {
  try {
    const { data } = await api<Facets>("/products/facets", { query, cache: "no-store" });
    return data;
  } catch (err) {
    if (isFrameworkSignal(err)) throw err;
    // Facets are optional — the listing still works without them — but a failure must be visible.
    console.error("[catalogue] facets request failed:", err);
    return { sizes: [], colours: [], fabrics: [], price: { min: 0, max: 0 } };
  }
}

/** Cached per slug. Returns null for an unknown/unpublished product so the page can 404. */
export async function getProduct(slug: string): Promise<ProductDetailData | null> {
  "use cache";
  cacheLife("minutes");
  try {
    const { data } = await api<ProductDetailData>(`/products/${encodeURIComponent(slug)}`);
    return data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function getCategory(slug: string): Promise<CategoryDetail | null> {
  "use cache";
  cacheLife("minutes");
  try {
    const { data } = await api<CategoryDetail>(`/categories/${encodeURIComponent(slug)}`);
    return data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
