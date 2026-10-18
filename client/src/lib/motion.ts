/**
 * The motion rules for the whole storefront, in one place.
 *
 *  1. Nothing is ever hidden unless motion is CONFIRMED allowed. A tiny inline script (MOTION_BOOT_SCRIPT) runs
 *     before the first paint and sets `data-motion="ok"` on <html> only when the visitor has not asked for reduced
 *     motion. Every "hidden until revealed" rule in the CSS is scoped to that attribute, and carries a timed
 *     failsafe, so a script that never runs can never leave content invisible.
 *  2. Heavy visuals (the 3D scene, smooth scrolling, cursor effects) are for capable desktops. Phones, low-power
 *     devices, "save data" users and anyone preferring reduced motion get the same page without them.
 *  3. Libraries (GSAP, Lenis, Three.js) are imported on demand, after the page is interactive, so none of them is
 *     in the initial bundle.
 */

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
export const FINE_POINTER = "(pointer: fine)";
export const WIDE = "(min-width: 1024px)";

/**
 * Runs synchronously in <head>, before the first paint (see Next's "preventing flash before hydration" guide).
 *   data-motion="ok"    reveals and smooth scrolling may run
 *   data-hero="intro"   the desktop hero plays its scripted entrance (phones show the headline instantly: it is
 *                       the largest element on screen and must not wait for JavaScript to become visible)
 */
export const MOTION_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,m=window.matchMedia;if(!m)return;if(m('${REDUCED_MOTION}').matches)return;d.setAttribute('data-motion','ok');if(m('${WIDE}').matches&&m('${FINE_POINTER}').matches)d.setAttribute('data-hero','intro')}catch(e){}})();`;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(REDUCED_MOTION).matches;
}

export function motionAllowed(): boolean {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-motion") === "ok";
}

/**
 * Props for any element that animation code decorates after the page loads (adds a class, sets an inline style).
 *
 * Sections stream in behind <Suspense> boundaries and hydrate in time slices, possibly AFTER the animation code has
 * already touched their server-rendered nodes. React would then report "a tree hydrated but some attributes of the
 * server rendered HTML didn't match" (an error overlay in development, and a node it refuses to patch). The
 * decoration is intentional, so tell React so: `suppressHydrationWarning` silences exactly the attribute mismatch on
 * this one element and nothing else. Spread these instead of writing the data attribute by hand.
 */
export const REVEAL = { "data-reveal": true, suppressHydrationWarning: true } as const;
export const HERO_FADE = { "data-hero-fade": true, suppressHydrationWarning: true } as const;

/** Can this browser create a WebGL context at all? (Checked on a throw-away canvas, then released.) */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") || canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

interface NavigatorHints {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
}

/**
 * Should the hero load its 3D scene? Deliberately conservative: a missed 3D scene costs a little polish, a
 * mistaken one costs a slow, hot, battery-draining page.
 */
export function canRunHeroScene(): boolean {
  if (typeof window === "undefined") return false;
  const m = window.matchMedia;
  if (!m || m(REDUCED_MOTION).matches) return false;
  if (!m(WIDE).matches || !m(FINE_POINTER).matches) return false; // phones, tablets and touch laptops: static hero
  const nav = navigator as Navigator & NavigatorHints;
  if (nav.connection?.saveData) return false;
  if (nav.connection?.effectiveType && /(^|-)2g$|3g/.test(nav.connection.effectiveType)) return false;
  if ((nav.hardwareConcurrency ?? 8) < 4) return false;
  if ((nav.deviceMemory ?? 8) < 4) return false;
  return webglAvailable();
}
