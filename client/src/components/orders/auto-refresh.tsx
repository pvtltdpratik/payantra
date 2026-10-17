"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-reads the page's server data every few seconds while something is in flight (a parcel on its way), so the
 * customer sees "out for delivery" and their code without reloading. Pauses while the tab is hidden.
 */
export function AutoRefresh({ active, everyMs = 15_000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => window.clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
