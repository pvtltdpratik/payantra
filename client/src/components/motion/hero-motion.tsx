"use client";

import { useEffect } from "react";
import { loadGsap } from "@/lib/gsap";
import { FINE_POINTER, motionAllowed } from "@/lib/motion";

/**
 * The hero's entrance and its scroll parallax (renders nothing).
 *
 *  - Entrance: only where `html[data-hero="intro"]` (set before the first paint, desktop with motion allowed). The
 *    headline's lines rise out of a mask, then the supporting copy and buttons fade up in sequence. On phones this
 *    does not run at all, so the headline is on screen the instant the HTML arrives.
 *  - Parallax: the artwork moves a little slower than the page. Fine pointers only (on touch it would fight the
 *    browser's own scrolling).
 * Everything is reverted on unmount, and if GSAP fails to load the CSS failsafe shows the content anyway.
 */
export function HeroMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-hero-root]");
    if (!root || !motionAllowed()) return;
    // Phones and touch devices get neither the intro nor the parallax, so they should not pay for GSAP plugins.
    if (document.documentElement.getAttribute("data-hero") !== "intro" && !window.matchMedia(FINE_POINTER).matches) return;

    let cleanup: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      let kit: Awaited<ReturnType<typeof loadGsap>>;
      try {
        kit = await loadGsap();
      } catch {
        return;
      }
      if (cancelled) return;
      const { gsap, SplitText } = kit;

      const ctx = gsap.context(() => {
        const intro = document.documentElement.getAttribute("data-hero") === "intro";
        const headline = root.querySelector<HTMLElement>("[data-hero-headline]");
        const fades = Array.from(root.querySelectorAll<HTMLElement>("[data-hero-fade]"));

        if (intro && headline) {
          fades.forEach((el) => el.classList.add("reveal-active"));
          const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
          const split = SplitText.create(headline, { type: "lines", mask: "lines", linesClass: "hero-line" });
          headline.classList.add("reveal-active"); // the lines are masked now, so the headline may show
          tl.from(split.lines, { yPercent: 115, duration: 1.15, ease: "power4.out", stagger: 0.14 });
          tl.fromTo(fades, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.8, stagger: 0.12, onComplete: () => fades.forEach((el) => el.classList.add("is-revealed")) }, "-=0.7");
        }

        if (window.matchMedia(FINE_POINTER).matches) {
          const art = root.querySelector<HTMLElement>("[data-hero-art]");
          const copy = root.querySelector<HTMLElement>("[data-hero-copy]");
          const scrub = { trigger: root, start: "top top", end: "bottom top", scrub: true };
          if (art) gsap.to(art, { yPercent: 10, ease: "none", scrollTrigger: scrub });
          if (copy) gsap.to(copy, { yPercent: -6, ease: "none", scrollTrigger: scrub });
        }
      }, root);

      cleanup = () => ctx.revert();
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return null;
}
