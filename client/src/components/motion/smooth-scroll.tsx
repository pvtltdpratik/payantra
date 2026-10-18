"use client";

import { useEffect } from "react";
import { loadGsap, whenIdle } from "@/lib/gsap";
import { FINE_POINTER, motionAllowed, REDUCED_MOTION } from "@/lib/motion";

/**
 * Lenis smooth scrolling, driven by GSAP's ticker so ScrollTrigger and Lenis agree on where the page is.
 *
 * Deliberately limited to where it helps and cannot hurt:
 *  - only with a fine pointer (a mouse or trackpad): on touch devices the native scroll is already smooth and
 *    iOS/Android momentum must not be replaced;
 *  - never with reduced motion, and it switches itself off if the visitor turns that setting on mid-session;
 *  - it does not touch the keyboard, find-in-page, the browser's back/forward scroll restoration, or the skip link.
 * Scrollable popups (menus, dialogs, drawers) opt out with `data-lenis-prevent` so their own scrolling works.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (!motionAllowed() || !window.matchMedia(FINE_POINTER).matches) return;

    let destroy: (() => void) | null = null;
    let cancelled = false;

    const start = async () => {
      const [{ default: Lenis }, { gsap, ScrollTrigger }] = await Promise.all([import("lenis"), loadGsap()]);
      if (cancelled) return;

      const lenis = new Lenis({ autoRaf: false, lerp: 0.1, smoothWheel: true, anchors: false });
      lenis.on("scroll", ScrollTrigger.update);
      const tick = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);

      destroy = () => {
        gsap.ticker.remove(tick);
        lenis.destroy();
      };
    };

    const cancelIdle = whenIdle(() => void start());

    // If the visitor asks for reduced motion while the page is open, stop at once.
    const media = window.matchMedia(REDUCED_MOTION);
    const onChange = () => {
      if (media.matches) {
        destroy?.();
        destroy = null;
      }
    };
    media.addEventListener("change", onChange);

    return () => {
      cancelled = true;
      cancelIdle();
      media.removeEventListener("change", onChange);
      destroy?.();
    };
  }, []);

  return null;
}
