/**
 * GSAP is large, so nothing imports it at the top level. Animation components call `loadGsap()` from an effect
 * (after the page is interactive); the plugins are registered exactly once and the same promise is shared.
 */
export interface GsapKit {
  gsap: typeof import("gsap").gsap;
  ScrollTrigger: typeof import("gsap/ScrollTrigger").ScrollTrigger;
  SplitText: typeof import("gsap/SplitText").SplitText;
}

let loading: Promise<GsapKit> | null = null;
let loaded: GsapKit | null = null;
let coreLoading: Promise<GsapKit["gsap"]> | null = null;

/**
 * GSAP on its own (about a quarter of the size of the full kit). The scroll reveal needs nothing more, so phones,
 * which never run parallax, SplitText or scroll-linked scenes, never download ScrollTrigger or SplitText at all.
 */
export function loadGsapCore(): Promise<GsapKit["gsap"]> {
  coreLoading ??= import("gsap")
    .then((m) => m.gsap)
    .catch((err) => {
      coreLoading = null;
      throw err;
    });
  return coreLoading;
}

/** The full kit if something has already loaded it, otherwise null (never triggers a download). */
export const loadedGsapKit = () => loaded;


export function loadGsap(): Promise<GsapKit> {
  loading ??= (async () => {
    const [{ gsap }, { ScrollTrigger }, { SplitText }] = await Promise.all([import("gsap"), import("gsap/ScrollTrigger"), import("gsap/SplitText")]);
    gsap.registerPlugin(ScrollTrigger, SplitText);
    loaded = { gsap, ScrollTrigger, SplitText };
    return loaded;
  })().catch((err) => {
    loading = null; // allow a retry on the next call
    throw err;
  });
  return loading;
}

/** Runs `fn` when the browser is idle (or after a short delay where requestIdleCallback is missing). */
export function whenIdle(fn: () => void, timeout = 1500): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 200);
  return () => window.clearTimeout(id);
}
