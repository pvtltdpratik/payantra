# The landing page and motion layer (Phase 5)

How the home page is built, how the animation stays optional, and how to change it without breaking either.

## The one rule

**The page must be complete without motion.** Every animation is added on top of finished HTML. If JavaScript
fails, if the visitor asked for reduced motion, if the device is a phone or a low-power laptop, the page still shows
every headline, product and button, immediately. Shopping is never gated on an animation.

## Home page sections

All of it is read live from the API, streams in independently behind `<Suspense>`, reserves its space with a skeleton
of the same height (no layout shift), and **removes itself when there is nothing to show**: no fake products, offers
or reviews.

| # | Section | Source |
|---|---|---|
| 1 | Announcement bar | Admin banner with placement `ANNOUNCEMENT`; falls back to a default line (same 36 px height) |
| 2 | Header | existing |
| 3 | Hero | Static copy + SVG artwork; optional 3D scene |
| – | Trust bar | `GET /settings/public` (the same shipping/returns/COD numbers checkout uses) |
| 4 | Shop by category | Category tree (top level, with product counts) |
| 5 | Featured sarees, new arrivals | Products (`category=sarees&featured`, falling back to featured; `newArrival`, falling back to newest) |
| 6 | Best sellers | Products sorted by popularity |
| 7 | Women / Men collections | Category tree grouped by gender |
| 8 | Craftsmanship | Scroll-storytelling (GSAP ScrollTrigger); static, factual copy |
| 9 | Seasonal / festive collections | `GET /collections` (seasonal first) |
| 10 | Limited-time offers | Admin banners with placement `HOME_STRIP` (the API only serves banners whose date window is open) |
| 11 | Customer reviews | `GET /reviews/featured`: visible reviews of 4★+ with real text, one per product |
| 12 | Brand story (`#story`) | Static copy |
| 13 | Newsletter | `POST /newsletter/subscribe` (same endpoint as the footer) |
| 14 | Style gallery | The newest products' own photos, each linking to its product (no third-party feed or script) |
| 15 | Footer | Shop, categories, account, help/policies, contact and social links |

Admin changes reach the page within about 30 seconds (`services/home.ts`: revalidate 20 s). Product rows are fetched
fresh on every request.

### Contact details and social links

Set these in `client/.env` (all optional). Anything left empty is **not shown**; the site never renders a made-up
phone number or a dead social link.

`NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_SUPPORT_PHONE`, `NEXT_PUBLIC_SUPPORT_HOURS`,
`NEXT_PUBLIC_SOCIAL_INSTAGRAM`, `NEXT_PUBLIC_SOCIAL_FACEBOOK`, `NEXT_PUBLIC_SOCIAL_X`, `NEXT_PUBLIC_SOCIAL_YOUTUBE`
(only `http(s)` URLs are accepted). They are inlined at build time.

### Policy pages

`/shipping` and `/returns` quote the live store settings. `/privacy` and `/terms` describe what the application
actually does with data, in plain language, but **they are not legal advice. Have a lawyer review and adapt them
before launch.**

## How motion is layered

```
HTML (always complete)
 └─ pre-paint script (lib/motion.ts)  sets <html data-motion="ok"> unless prefers-reduced-motion,
                                      and data-hero="intro" for wide screens with a fine pointer
     └─ CSS hides revealable content ONLY under html[data-motion="ok"], and each hidden thing has a timed
        failsafe animation that shows it after 3.5 s if JavaScript never takes over
         └─ GSAP (loaded on demand, in idle time) takes over: .reveal-active cancels the failsafe
             └─ Lenis smooth scroll (fine pointers only), three.js scene (capable desktops only)
```

| Piece | File | Notes |
|---|---|---|
| Motion gate | `src/lib/motion.ts` | `MOTION_BOOT_SCRIPT`, `motionAllowed()`, `canRunHeroScene()` |
| GSAP loader | `src/lib/gsap.ts` | `loadGsap()` dynamic-imports GSAP + ScrollTrigger + SplitText once. Nothing imports GSAP at the top level, so it is off the critical path |
| Smooth scroll | `components/motion/smooth-scroll.tsx` | Lenis driven by `gsap.ticker`, synced with ScrollTrigger. Not started on touch devices or with reduced motion. Native scrolling is kept for keyboard, anchors and modals (`data-lenis-prevent` on dialogs and sheets) |
| Scroll reveal | `components/motion/scroll-reveal.tsx` | Any element with `data-reveal` fades up when it enters the viewport; batches stagger. A MutationObserver picks up streamed-in sections |
| Hero motion | `components/motion/hero-motion.tsx` | Desktop headline line-reveal (SplitText) and parallax. Phones skip the intro so the headline (the LCP element) is never hidden |
| Page transition | `app/(storefront)/template.tsx` | A 0.32 s opacity fade between pages. Never on the first load; gated on `data-motion` |
| 3D hero | `components/home/hero-{stage,canvas}.tsx` | React Three Fiber, lazy-loaded |
| Effects from ReactBits | `components/reactbits/` | `Magnet` (CTA), `ShinyText` (eyebrow), `SpotlightCard` (category tiles) |

### The 3D hero

The static SVG scene (`hero-art.tsx`) is what everyone gets first. The 3D scene (a silk cloth with a custom shader,
a gold ring and a ruby, lit by an in-code environment, so there is no HDR download) is added only if **all** of these
hold: not reduced-motion, a wide screen, a fine pointer, no Save-Data and not a 2G/3G connection, at least 4 CPU
cores, at least 4 GB of memory (where the browser reports it) and WebGL available. It loads in idle time, fades in
after its first frame, and:

- renders only while the hero is on screen and the tab is visible;
- can be paused (a visible **Pause animation** button, WCAG 2.2.2);
- falls back to the static artwork on any error or a lost WebGL context;
- is `aria-hidden`, contains nothing focusable, and never intercepts clicks.

On phones the three.js chunk is **never downloaded**.

### ReactBits

ReactBits is not an npm package: components are copied into the project. Three were chosen, reviewed and adapted
(lint-clean, no refs written during render). The licence (MIT + Commons Clause) permits use inside an application
like this one, and requires the notice to be kept: see `components/reactbits/LICENSE.md` and the header of each
file. Do not resell the components on their own.

## Accessibility notes

- One `<h1>`; every section is a landmark labelled by its heading; "Skip to content" is the first Tab stop.
- All animation respects `prefers-reduced-motion`: nothing is hidden, nothing moves, Lenis and three.js do not start.
- Category tiles, offers, collections and gender panels are single links (a stretched-link pattern), so there is one
  tab stop and one accessible name each.
- Focus rings are never removed; hover-only captions (the gallery) are also shown on keyboard focus.
- Decorative art is `aria-hidden`; product photos keep their alt text.

## Verifying it

```bash
cd e2e && npm run e2e -- home          # structure, live data, phone, reduced motion, no-JS, CLS, a11y basics
```

The spec records whether this machine rendered the 3D scene or fell back to the static artwork; both are correct.

### Lighthouse (mobile) and the performance budget

Lighthouse is run by hand against the production build (it is slow and depends on the machine, so it is not in CI):

```bash
cd e2e && node serve.mjs                # builds and serves the production storefront on :3100, prints READY
npx lighthouse http://localhost:3100/ --only-categories=performance,accessibility,best-practices,seo   --form-factor=mobile --chrome-flags="--headless=new"
```

**Run it plugged in, with nothing else busy, and look at `environment.benchmarkIndex` in the JSON.** Lighthouse
slows the CPU 4× and assumes a fast desktop; on a throttled or battery-saving laptop the same page can score 20 points
lower. What was measured while building this phase (Edge/Chromium, mobile profile, simulated 4G):

| Build | Perf | TBT | LCP | CLS | Transfer | Machine |
|---|---|---|---|---|---|---|
| Landing page as first built | 49 | 1.7 s | 5.3 s | 0 | 626 kB | benchmark ~600 |
| + session code lazy-loaded, GSAP deferred to idle, `content-visibility` below the fold | **79–80** | 0.2 s | 4.5 s | 0 | 528 kB | benchmark ~2500 (AC power) |
| + self-hosted Latin-only fonts, GSAP split so phones skip ScrollTrigger/SplitText | 60–68 on battery | 0.6–1.2 s | 4.2–4.7 s | 0 | **423 kB** | benchmark 300–1500 (battery, 21 %) |

So: **accessibility, best-practices and SEO are 100, CLS is 0, and performance is in the 60s on a throttled laptop
and about 80 on a fast one. The ≥ 85 exit criterion has not been demonstrated on this hardware.** The final build was
only measured on battery; re-run it plugged in and record the number. If it is still below 85, the next levers are
listed below. The 3D scene and Lenis never load on phones, so they cost the mobile score nothing.

What moved the number, in order of effect:

1. **The rupee sign was costing 85 kB.** `₹` is in Inter's `latin-ext` file, so a price anywhere in the first screen
   downloaded it. Fonts are now self-hosted Latin subsets (`src/app/fonts/`, both SIL OFL), and `₹` uses the device font.
2. **The Supabase browser client (~66 kB gzipped) no longer loads for signed-out visitors** on storefront pages.
   `lib/supabase/lazy.ts` checks for the auth cookie first. After email sign-in/sign-out the screens call
   `announceAuthChange()` so the header bag, bell and wishlist hearts refresh.
3. **GSAP loads in idle time** (never ahead of first paint), and phones load only GSAP core (the scroll reveal);
   ScrollTrigger and SplitText are desktop-only.
4. **`content-visibility: auto`** on below-the-fold sections (`.cv-auto`) removes most initial layout work. Not applied
   to the craft story (sticky + scroll triggers), the brand story (an anchor target) or the footer (it makes
   accessibility checkers report false contrast failures).

Next levers if needed: trim hydration (the product cards are client components because of the wishlist heart; a single
delegated heart would cut ~16 hydrated trees), move `ShinyText`/`Magnet` to desktop only, and reduce the home page's
RSC payload by lowering row sizes on small screens.

## Known limitations

- Collections have an admin API but no admin screen yet, so the seasonal section shows what the API holds.
- Product, category and collection imagery is generated placeholder artwork (`/placeholder/…`) until real
  photography is uploaded; the page is designed to look right with either.
- The "style gallery" is built from product photos, not a live Instagram feed: a real feed needs Meta app review and
  would add a third-party script. Social links go to the profiles configured in the environment.
- Policy pages are plain-language templates, not legal advice.
- The hero's 3D scene is gated conservatively; some capable machines will correctly choose the static scene.
