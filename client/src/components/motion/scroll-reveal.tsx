"use client";

import { useEffect } from "react";
import { loadGsapCore, whenIdle } from "@/lib/gsap";
import { motionAllowed } from "@/lib/motion";

/**
 * Staggered entrance for anything marked `data-reveal`: cards, headings, panels. One IntersectionObserver watches
 * them; elements that come into view in the same moment are revealed together with a short stagger.
 *
 * Content streams in after hydration (Suspense), so a MutationObserver picks up late arrivals. The moment an
 * element is bound it gets `.reveal-active`, which cancels the CSS failsafe; if this code never gets that far, the
 * failsafe shows the content after 3.5 s instead. Reveal only ever runs when `html[data-motion="ok"]`.
 */
export function ScrollReveal() {
  useEffect(() => {
    if (!motionAllowed()) return;

    let cancelled = false;
    let io: IntersectionObserver | null = null;
    let mo: MutationObserver | null = null;
    let queue: Element[] = [];
    let frame = 0;
    let scanFrame = 0;
    let cancelIdle: (() => void) | null = null;

    void (async () => {
      // Wait for an idle moment so the animation library never competes with the first paint for bandwidth or CPU.
      // The 2 s ceiling stays inside the CSS failsafe (3.5 s), so nothing is ever left hidden.
      await new Promise<void>((resolve) => {
        cancelIdle = whenIdle(resolve, 2000);
      });
      if (cancelled) return;
      let gsap: Awaited<ReturnType<typeof loadGsapCore>>;
      try {
        gsap = await loadGsapCore();
      } catch {
        return; // the CSS failsafe reveals everything
      }
      if (cancelled) return;

      const play = (batch: Element[]) => {
        // Reading order: top to bottom, then left to right, so a row of cards fans out naturally.
        batch.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return Math.abs(ra.top - rb.top) > 24 ? ra.top - rb.top : ra.left - rb.left;
        });
        gsap.fromTo(
          batch,
          { opacity: 0, y: 28 },
          {
            opacity: 1,
            y: 0,
            duration: 0.9,
            ease: "power3.out",
            stagger: 0.08,
            overwrite: "auto",
            onComplete: () => batch.forEach((el) => el.classList.add("is-revealed")),
          },
        );
      };

      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            io?.unobserve(e.target);
            queue.push(e.target);
          }
          if (queue.length && !frame) {
            frame = requestAnimationFrame(() => {
              frame = 0;
              const batch = queue;
              queue = [];
              play(batch);
            });
          }
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
      );

      const scan = () => {
        document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-reveal-bound])").forEach((el) => {
          el.setAttribute("data-reveal-bound", "");
          // On a slow device this code can arrive after the 3.5 s CSS failsafe has already shown the element. Taking
          // over now would remove that animation and snap the element back to invisible, so leave it as it is.
          if (getComputedStyle(el).opacity !== "0") {
            el.classList.add("is-revealed");
            return;
          }
          el.classList.add("reveal-active"); // we are in charge now: no failsafe
          io?.observe(el);
        });
      };
      scan();
      document.documentElement.setAttribute("data-reveal-ready", ""); // "scroll reveals are live" (also used by the e2e specs)
      // Coalesce bursts of DOM changes into one scan per frame.
      mo = new MutationObserver(() => {
        if (scanFrame) return;
        scanFrame = requestAnimationFrame(() => {
          scanFrame = 0;
          scan();
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    })();

    return () => {
      cancelled = true;
      cancelIdle?.();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scanFrame);
      io?.disconnect();
      mo?.disconnect();
    };
  }, []);

  return null;
}
