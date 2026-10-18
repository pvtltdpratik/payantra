"use client";

import { useEffect, useRef, useState } from "react";
import { loadGsap, whenIdle } from "@/lib/gsap";
import { FINE_POINTER, motionAllowed, WIDE } from "@/lib/motion";
import { cn } from "@/lib/utils";

const CHAPTERS = [
  {
    kicker: "The loom",
    title: "Cloth begins as a rhythm",
    body: "Handloom weaving is slow on purpose. Warp and weft are set by hand, and every pass of the shuttle leaves the small irregularities that machines iron out and collectors look for.",
  },
  {
    kicker: "The thread",
    title: "Gold, worked into the weave",
    body: "Zari borders, brocade motifs and kantha stitches are built up thread by thread. They are what turns a length of fabric into something that gets handed down.",
  },
  {
    kicker: "The colour",
    title: "Dyed, printed and painted by hand",
    body: "Ikat resist-dyeing, block printing and natural colour each carry the character of the maker's region. No two lengths come out exactly alike, and that is the point.",
  },
  {
    kicker: "The wearer",
    title: "Made to be lived in",
    body: "We pair heritage techniques with cuts and fabrics that suit modern life, so a piece made the old way can be worn on an ordinary Tuesday as easily as at a wedding.",
  },
];

/**
 * Scroll storytelling. The chapters are ordinary content that is fully readable without any script. When motion is
 * allowed, GSAP ScrollTrigger tracks which chapter is centred, lights it up, and fills a progress rule beside the
 * sticky heading. Touch devices and reduced-motion visitors simply get the readable version.
 */
export function CraftStory() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const [live, setLive] = useState(false);

  useEffect(() => {
    // The scroll-linked highlight is a desktop flourish; phones and tablets get the plain, fully readable list.
    if (!motionAllowed() || !root.current || !window.matchMedia(`${WIDE} and ${FINE_POINTER}`).matches) return;
    let revert: (() => void) | undefined;
    let cancelled = false;
    // After the first paint, in an idle moment: the readable version is already complete without this.
    const cancelIdle = whenIdle(() => {
      void loadGsap()
      .then(({ gsap, ScrollTrigger }) => {
        const section = root.current;
        if (cancelled || !section) return;
        const ctx = gsap.context(() => {
          setLive(true);
          section.querySelectorAll<HTMLElement>("[data-chapter]").forEach((el, i) => {
            ScrollTrigger.create({
              trigger: el,
              start: "top 62%",
              end: "bottom 38%",
              onToggle: (self) => self.isActive && setActive(i),
            });
          });
          gsap.fromTo(
            "[data-craft-progress]",
            { scaleY: 0 },
            { scaleY: 1, ease: "none", scrollTrigger: { trigger: section.querySelector("[data-chapters]"), start: "top 60%", end: "bottom 45%", scrub: 0.4 } },
          );
        }, section);
        revert = () => ctx.revert();
      })
      .catch(() => {
        /* the readable version stays */
      });
    }, 3000);

    return () => {
      cancelled = true;
      cancelIdle();
      revert?.();
    };
  }, []);

  return (
    <section ref={root} className="woven relative bg-[#1f0a12] text-primary-foreground" aria-labelledby="craft-h" data-testid="craft-story">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:py-24 lg:grid-cols-[5fr_6fr] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <div className="flex gap-6">
            <div aria-hidden className="relative hidden w-px bg-white/15 lg:block">
              <div data-craft-progress className={cn("absolute inset-x-0 top-0 h-full origin-top bg-gold", !live && "scale-y-0")} />
            </div>
            <div data-reveal>
              <p className="mb-3 text-xs font-medium uppercase tracking-[0.3em] text-gold">Craftsmanship</p>
              <h2 id="craft-h" className="text-4xl font-semibold leading-tight sm:text-5xl">
                Made by hand,
                <br />
                kept for years
              </h2>
              <p className="mt-5 max-w-md text-primary-foreground/75">
                Behind every piece is a tradition that took generations to refine. This is how it comes to be.
              </p>
            </div>
          </div>
        </div>

        <ol data-chapters className="space-y-6 lg:space-y-24 lg:py-16">
          {CHAPTERS.map((c, i) => (
            <li
              key={c.kicker}
              data-chapter
              data-reveal
              aria-current={live && active === i ? "step" : undefined}
              className={cn("rounded-2xl border border-white/10 p-6 transition-[opacity,background-color] duration-500 sm:p-8", live && active !== i && "opacity-55", live && active === i && "bg-white/5")}
            >
              <p className="text-xs font-medium uppercase tracking-[0.25em] text-gold">
                <span className="tabular-nums">0{i + 1}</span> · {c.kicker}
              </p>
              <h3 className="mt-3 text-2xl font-semibold sm:text-3xl">{c.title}</h3>
              <p className="mt-3 max-w-lg leading-relaxed text-primary-foreground/80">{c.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
