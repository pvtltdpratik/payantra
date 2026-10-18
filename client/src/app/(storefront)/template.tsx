"use client";

import { useLayoutEffect, useRef } from "react";

/** True once any storefront page has been shown; a template that mounts after that is a client navigation. */
let shownBefore = false;

/**
 * A short fade when the shopper navigates between pages. A template (unlike a layout) mounts afresh on every
 * navigation. The first page of a visit never fades, so the initial load (and its LCP) is untouched, and the CSS
 * only animates when `html[data-motion="ok"]`, i.e. never for reduced-motion visitors.
 *
 * The decision is made once per mount and remembered in a ref: React StrictMode (development) runs effects twice on
 * the same instance, and the second run must not mistake the first page for a navigation.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const isNavigation = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    if (isNavigation.current === null) {
      isNavigation.current = shownBefore;
      shownBefore = true;
    }
    if (isNavigation.current) el.current?.classList.add("page-in");
  }, []);
  return <div ref={el}>{children}</div>;
}
