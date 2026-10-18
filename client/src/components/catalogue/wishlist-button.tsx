"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { authedApi } from "@/lib/client-api";
import { getBrowserSession, watchAuth } from "@/lib/supabase/lazy";
import { cn } from "@/lib/utils";

/**
 * Module-level cache of the shopper's wishlist ids, shared by every heart on the page so a grid of
 * 24 cards makes ONE request, not 24.
 */
let idsPromise: Promise<Set<string>> | null = null;
const listeners = new Set<() => void>();
let ids = new Set<string>();

async function loadIds(): Promise<Set<string>> {
  if (!(await getBrowserSession())) return new Set();
  try {
    const res = await authedApi<string[]>("/wishlist/ids");
    return new Set(res.data);
  } catch {
    return new Set();
  }
}

let watchingAuth = false;

function ensureLoaded() {
  if (!watchingAuth) {
    watchingAuth = true;
    // A different person may sign in on the same tab: never show the previous person's hearts.
    watchAuth(() => {
      idsPromise = null;
      ids = new Set();
      listeners.forEach((l) => l());
      void ensureLoaded();
    });
  }
  idsPromise ??= loadIds().then((s) => {
    ids = s;
    listeners.forEach((l) => l());
    return s;
  });
  return idsPromise;
}

function set(next: Set<string>) {
  ids = next;
  listeners.forEach((l) => l());
}

export function WishlistButton({ productId, productName, className }: { productId: string; productName: string; className?: string }) {
  const router = useRouter();
  const [, force] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    void ensureLoaded();
    return () => void listeners.delete(l);
  }, []);

  const saved = ids.has(productId);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault(); // the heart sits inside a product link
    e.stopPropagation();
    if (busy) return;

    if (!(await getBrowserSession())) {
      router.push(`/auth/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    setBusy(true);
    const wasSaved = ids.has(productId);
    // Optimistic: flip immediately, roll back if the server says no.
    const optimistic = new Set(ids);
    if (wasSaved) optimistic.delete(productId);
    else optimistic.add(productId);
    set(optimistic);
    try {
      await authedApi(`/wishlist/${productId}`, { method: wasSaved ? "DELETE" : "POST" });
    } catch {
      const rollback = new Set(ids);
      if (wasSaved) rollback.add(productId);
      else rollback.delete(productId);
      set(rollback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${productName} from wishlist` : `Save ${productName} to wishlist`}
      className={cn("grid size-9 place-items-center rounded-full bg-background/90 shadow-sm hover:bg-background", className)}
    >
      <Heart aria-hidden className={cn("size-[18px]", saved ? "fill-primary text-primary" : "text-foreground")} />
    </button>
  );
}
