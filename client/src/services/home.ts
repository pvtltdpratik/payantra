import { cacheLife } from "next/cache";
import { api, isFrameworkSignal } from "@/lib/api";
import type { FeaturedReview, PublicBanner, PublicCollection, PublicSettings } from "@/types/home";

/**
 * Loaders for the home page and the pages around it. All of them are cached for about a minute and NONE can throw:
 * an error escaping a `"use cache"` scope is claimed by Next's prerender and fails the whole build (for instance
 * in CI, where no API is running), so a failure is returned as a value and the section is simply left out.
 */
/**
 * Admin edits (an announcement, an offer, a collection) should reach shoppers quickly: after 20 s the next visit
 * triggers a background refresh and the one after it sees the change. Entries expire after 10 minutes.
 */
const HOME_CACHE = { stale: 30, revalidate: 20, expire: 600 } as const;

type Result<T> = { ok: true; data: T } | { ok: false };

async function guarded<T>(label: string, fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (isFrameworkSignal(err)) throw err;
    console.error(`[home] ${label} request failed:`, err);
    return { ok: false };
  }
}

async function loadBanners(placement: PublicBanner["placement"]): Promise<Result<PublicBanner[]>> {
  "use cache";
  cacheLife(HOME_CACHE);
  return guarded("banners", async () => (await api<PublicBanner[]>("/banners", { query: { placement } })).data);
}
export async function getBanners(placement: PublicBanner["placement"]): Promise<PublicBanner[]> {
  const r = await loadBanners(placement);
  return r.ok ? r.data : [];
}

async function loadCollections(): Promise<Result<PublicCollection[]>> {
  "use cache";
  cacheLife(HOME_CACHE);
  return guarded("collections", async () => (await api<PublicCollection[]>("/collections")).data);
}
export async function getCollections(): Promise<PublicCollection[]> {
  const r = await loadCollections();
  return r.ok ? r.data : [];
}

async function loadPublicSettings(): Promise<Result<PublicSettings>> {
  "use cache";
  cacheLife(HOME_CACHE);
  return guarded("settings", async () => (await api<PublicSettings>("/settings/public")).data);
}
export async function getPublicSettings(): Promise<PublicSettings | null> {
  const r = await loadPublicSettings();
  return r.ok ? r.data : null;
}

async function loadFeaturedReviews(): Promise<Result<FeaturedReview[]>> {
  "use cache";
  cacheLife(HOME_CACHE);
  return guarded("featured reviews", async () => (await api<FeaturedReview[]>("/reviews/featured", { query: { limit: 6 } })).data);
}
export async function getFeaturedReviews(): Promise<FeaturedReview[]> {
  const r = await loadFeaturedReviews();
  return r.ok ? r.data : [];
}
