import { api } from "@/lib/api";
import type { Suggestions } from "@/types/catalogue";

/** Browser-safe (no server-only imports): called by the search box as the shopper types. */
export async function fetchSuggestions(q: string, signal?: AbortSignal): Promise<Suggestions> {
  const { data } = await api<Suggestions>("/search/suggestions", { query: { q }, signal });
  return data;
}
