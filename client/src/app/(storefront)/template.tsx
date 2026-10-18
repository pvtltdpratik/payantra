"use client";

import { useLayoutEffect, useRef } from "react";

/** True once any storefront page has been shown; a template that mounts after that is a client navigation. */
let shownBefore = false;

/**
 * A short fade when the shopper navigates between pages. A template (unlike a layout) mounts afresh on every
 * navigation. The first page of a visit never fades, so the initial load (and its LCP) is untouched, and the CSS
 * only animates when `html[data-motion="ok"]`, i.e. never for reduced-motion visitors.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (shownBefore) el.current?.classList.add("page-in");
    shownBefore = true;
  }, []);
  return <div ref={el}>{children}</div>;
}
