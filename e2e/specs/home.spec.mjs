import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { artifacts, clickText, goto, hydrated, newPage, settle, sleep, text } from '../lib/browser.mjs';

/**
 * Phase 5: the landing page.
 *
 * What this proves, in a real browser against the production build:
 *   · the page is complete without motion (reduced-motion, no JavaScript, phones): nothing is hidden, nothing needs
 *     an animation to become visible, and phones never load the 3D scene
 *   · the sections come from live data and disappear when there is nothing to show
 *   · an admin's announcement and offer reach the page, and leave it when removed
 *   · desktop gets smooth scroll and (where WebGL works) the 3D hero, with a pause control and a static fallback
 *   · layout does not shift while the page streams in
 */
export async function run({ stack, browser, t }) {
  mkdirSync(artifacts, { recursive: true });
  const api = (who, method, path, body) => stack.apiAs(who, method, path, body);
  const pub = async (path) => (await (await fetch(`${stack.api}${path}`)).json()).data;

  /** Layout-shift score for a page: start observing before any script runs. */
  const trackShift = (page) =>
    page.evaluateOnNewDocument(() => {
      window.__cls = 0;
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {
        /* unsupported */
      }
    });

  /**
   * Scrolls to the bottom in steps, as a person would, so every streamed-in section arrives and every reveal fires.
   * The page grows while it streams, so the height is re-measured on every step and the walk ends only once the
   * bottom has been reached with nothing new arriving.
   */
  const scrollThrough = async (page) => {
    await page.waitForFunction(() => ['row-new-arrivals', 'newsletter-band'].every((id) => document.querySelector(`[data-testid=${id}]`)), { timeout: 20_000 }).catch(() => undefined);
    let stable = 0;
    for (let y = 0, last = 0; stable < 3; y += 500) {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await sleep(80);
      if (y + 900 >= height) {
        stable = height === last ? stable + 1 : 0;
        last = height;
        y -= 500; // stay at the bottom while it settles
        await sleep(300);
      }
    }
    // Some sections stream in after the visitor has already passed them; a person scrolling back up reveals them.
    for (let y = await page.evaluate(() => scrollY); y > 0; y -= 500) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await sleep(80);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);
  };

  const SECTIONS = ['trust-bar', 'category-tiles', 'row-new-arrivals', 'row-best-sellers', 'gender-panels', 'craft-story', 'brand-story', 'newsletter-band', 'style-gallery'];
  const hidden = (page) =>
    page.evaluate(() => {
      // Anything still invisible after the page settled would be content that needs an animation to appear.
      return [...document.querySelectorAll('[data-reveal],[data-hero-fade],[data-hero-headline]')]
        .filter((el) => getComputedStyle(el).opacity === '0' && el.getBoundingClientRect().height > 0)
        .map((el) => (el.getAttribute('data-testid') || el.tagName.toLowerCase()) + ':' + (el.textContent || '').trim().slice(0, 20));
    });

  // ────────────────────────────────────────────────────────────────────────
  t.section('Home: desktop, live data, motion');
  const desk = await newPage(browser, stack, { isolated: true });
  await trackShift(desk);
  await goto(desk, stack, '/');
  await desk.waitForSelector('[data-testid=row-new-arrivals]', { timeout: 20_000 });
  await scrollThrough(desk);
  await settle(desk, 800);

  t.check('the hero carries the headline, and both calls to action', /Woven in tradition/.test(await text(desk, 'h1')) && (await desk.$eval('a[href="/shop"]', (a) => /Explore Collection/.test(a.textContent))) && (await desk.$eval('a[href="#story"]', (a) => /Discover Our Story/.test(a.textContent))));
  for (const id of SECTIONS) t.check(`the "${id}" section is on the page`, (await desk.$(`[data-testid=${id}]`)) !== null);
  t.check('there is exactly one h1, and sections are labelled by their headings', (await desk.$$eval('h1', (h) => h.length)) === 1 && (await desk.$$eval('main section[aria-labelledby]', (s) => s.every((e) => document.getElementById(e.getAttribute('aria-labelledby'))))));

  const settings = await pub('/settings/public');
  const trust = await text(desk, '[data-testid=trust-bar]');
  t.check('the trust bar quotes the return window the API serves', trust.includes(`${settings.returns.returnWindowDays}-day returns`), trust.replace(/\s+/g, ' ').slice(0, 120));

  const tree = await pub('/categories');
  const tiles = await desk.$$eval('[data-testid=category-tiles] li', (l) => l.length);
  t.check('the category tiles match the shop’s categories that have products', tiles === Math.min(8, tree.filter((c) => c.productCount > 0).length), `${tiles} tiles`);
  t.check('product cards on the page link to real product pages', (await desk.$$eval('[data-testid=row-new-arrivals] a[href^="/product/"]', (a) => a.length)) > 0);

  // The page caches featured reviews for ~20 s (a review posted moments ago by an earlier spec may not be there yet):
  // reload until the page and the API agree, then assert.
  let reviews = [];
  let shown = 0;
  for (let i = 0; i < 20; i++) {
    reviews = await pub('/reviews/featured?limit=6');
    shown = await desk.$$eval('[data-testid=home-reviews] li', (l) => l.length).catch(() => 0);
    if (shown === Math.min(6, reviews.length)) break;
    await sleep(4000);
    await desk.reload({ waitUntil: 'load' });
    await scrollThrough(desk);
  }
  t.check('customer reviews on the page are exactly what the API features (none invented)', shown === Math.min(6, reviews.length), `${shown} shown, ${reviews.length} featured`);

  t.check('smooth scroll (Lenis) is active on a desktop with a mouse', await desk.waitForFunction(() => document.documentElement.classList.contains('lenis'), { timeout: 8000 }).then(() => true, () => false));
  t.check('nothing is left invisible once the page has settled', (await hidden(desk)).length === 0, (await hidden(desk)).join(', '));

  // The hero: 3D if this machine can run it, otherwise the static scene. Both are correct; either must work fully.
  await desk.waitForFunction(() => document.querySelector('[data-testid=hero-stage]')?.dataset.mode !== 'static' || performance.now() > 9000, { timeout: 12_000 }).catch(() => undefined);
  await sleep(2500);
  const mode = await desk.$eval('[data-testid=hero-stage]', (e) => `${e.dataset.mode}/${e.dataset.ready}`);
  const gpu = mode.startsWith('scene');
  t.check(`the hero scene ${gpu ? 'rendered in 3D' : 'fell back to the static artwork'} (${mode})`, true);
  if (gpu) {
    t.check('the 3D canvas is hidden from assistive technology, and nothing in it is focusable', (await desk.$eval('[data-testid=hero-stage]', (e) => e.getAttribute('aria-hidden') === 'true' && !e.querySelector('a,button,input'))) === true);
    t.check('there is a visible Pause control for the animation', (await desk.$eval('[data-testid=hero-pause]', (b) => /Pause animation/.test(b.textContent))) === true);
    await desk.click('[data-testid=hero-pause]');
    t.check('and pressing it pauses and says so', await desk.$eval('[data-testid=hero-pause]', (b) => b.getAttribute('aria-pressed') === 'true' && /Play animation/.test(b.textContent)));
    await desk.click('[data-testid=hero-pause]');
  }
  await desk.screenshot({ path: join(artifacts, 'home-desktop-hero.png') });
  await desk.screenshot({ path: join(artifacts, 'home-desktop-full.png'), fullPage: true });

  const cls = await desk.evaluate(() => window.__cls);
  t.check('layout did not shift while the desktop page loaded (CLS < 0.1)', cls < 0.1, `CLS ${cls.toFixed(4)}`);
  t.check('the page has no runtime errors', desk.__errors.length === 0, desk.__errors.join(' | ').slice(0, 200));

  // ── keyboard and focus ──
  await goto(desk, stack, '/');
  await desk.keyboard.press('Tab');
  t.check('the first Tab stop is the skip link', await desk.evaluate(() => /Skip to content/.test(document.activeElement?.textContent ?? '')));
  await desk.keyboard.press('Enter');
  t.check('and it moves to the main content', await desk.evaluate(() => location.hash === '#main'));
  await goto(desk, stack, '/');
  await desk.click('a[href="#story"]');
  await sleep(1200);
  t.check('"Discover Our Story" scrolls to the story section', await desk.evaluate(() => { const r = document.getElementById('story')?.getBoundingClientRect(); return !!r && r.top < innerHeight * 0.6 && r.bottom > 0; }));

  // ── admin content reaches the page and leaves it ──
  t.section('Home: announcement and offers follow the admin');
  {
    const made = [];
    const mk = async (body) => {
      const r = await api('admin', 'POST', '/admin/banners', body);
      if (r.status !== 201) throw new Error(`banner create failed: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      made.push(r.body.data.id);
      return r.body.data.id;
    };
    const before = await text(desk, '[data-testid=announcement-bar]').catch(() => '');
    t.check('with no announcement the bar shows the default line', /Handcrafted Indian fashion/.test(before), before);
    t.check('and there is no offers section while nothing is scheduled', (await desk.$('[data-testid=offers]')) === null);

    await mk({ title: 'Free gift wrap this week', subtitle: 'on every order', imageUrl: '/placeholder/5c1a2b?label=Notice', linkUrl: '/shop', placement: 'ANNOUNCEMENT' });
    await mk({ title: 'Festive Saree Sale', subtitle: 'Up to 20% off silk', imageUrl: '/placeholder/8d6a2b?label=Sale', linkUrl: '/shop?featured=true', placement: 'HOME_STRIP' });

    // Cached for ~20 s, then refreshed in the background: reload until the new content is served.
    const arrived = async () => {
      await desk.reload({ waitUntil: 'load' });
      await settle(desk, 300);
      const bar = await text(desk, '[data-testid=announcement-bar]').catch(() => '');
      return /Free gift wrap this week/.test(bar) && (await desk.$('[data-testid=offers]')) !== null;
    };
    let ok = false;
    for (let i = 0; i < 24 && !ok; i++) {
      ok = await arrived();
      if (!ok) await sleep(4000);
    }
    t.check('the new announcement replaces the default line and links through', ok && (await desk.$eval('[data-testid=announcement-bar] a', (a) => a.getAttribute('href'))) === '/shop');
    t.check('the scheduled offer appears under “limited-time offers”', ok && /Festive Saree Sale/.test(await text(desk, '[data-testid=offers]')) && (await desk.$eval('[data-testid=offers] a', (a) => a.getAttribute('href'))) === '/shop?featured=true');
    t.check('the bar did not change height when its text changed', await desk.$eval('[data-testid=announcement-bar]', (e) => Math.round(e.getBoundingClientRect().height) === 36));

    for (const id of made) await api('admin', 'DELETE', `/admin/banners/${id}`);
    const gone = async () => {
      await desk.reload({ waitUntil: 'load' });
      await settle(desk, 300);
      return /Handcrafted Indian fashion/.test(await text(desk, '[data-testid=announcement-bar]').catch(() => '')) && (await desk.$('[data-testid=offers]')) === null;
    };
    ok = false;
    for (let i = 0; i < 24 && !ok; i++) {
      ok = await gone();
      if (!ok) await sleep(4000);
    }
    t.check('deleting them restores the default bar and removes the offers section', ok);
  }
  await desk.close();

  // ────────────────────────────────────────────────────────────────────────
  t.section('Home: phone');
  const phone = await newPage(browser, stack, { mobile: true, isolated: true });
  await trackShift(phone);
  const sawHeadline = [];
  await phone.bringToFront(); // a background tab gets no animation frames, which would stall every reveal
  await phone.goto(stack.web + '/', { waitUntil: 'domcontentloaded' });
  sawHeadline.push(await phone.evaluate(() => { const h = document.querySelector('h1'); const r = h?.getBoundingClientRect(); return { opacity: h ? getComputedStyle(h).opacity : null, inView: !!r && r.top < innerHeight && r.height > 0 }; }));
  t.check('on a phone the headline is visible the moment the HTML is parsed (no entrance animation to wait for)', sawHeadline[0].opacity === '1' && sawHeadline[0].inView, JSON.stringify(sawHeadline[0]));
  await settle(phone, 600);
  await scrollThrough(phone);
  await settle(phone, 800);
  t.check('a phone never loads the 3D scene', (await phone.$('[data-testid=hero-stage] canvas')) === null && (await phone.$eval('[data-testid=hero-stage]', (e) => e.dataset.mode)) === 'static');
  t.check('the three.js engine was not even downloaded', !(await phone.evaluate(() => performance.getEntriesByType('resource').some((r) => /three/i.test(r.name)))));
  t.check('smooth scroll is off on touch (the browser’s own scrolling is kept)', !(await phone.evaluate(() => document.documentElement.classList.contains('lenis'))));
  t.check('there is no sideways scroll', await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  t.check('nothing is left invisible on the phone', (await hidden(phone)).length === 0, (await hidden(phone)).join(', '));
  const clsPhone = await phone.evaluate(() => window.__cls);
  t.check('layout did not shift while the phone page loaded (CLS < 0.1)', clsPhone < 0.1, `CLS ${clsPhone.toFixed(4)}`);
  await phone.screenshot({ path: join(artifacts, 'home-phone-hero.png') });
  await phone.screenshot({ path: join(artifacts, 'home-phone-full.png'), fullPage: true });
  await phone.close();

  // ────────────────────────────────────────────────────────────────────────
  t.section('Home: reduced motion and no JavaScript');
  const calm = await newPage(browser, stack, { isolated: true });
  await calm.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await trackShift(calm);
  await goto(calm, stack, '/');
  await scrollThrough(calm);
  t.check('with reduced motion requested, no motion is switched on', await calm.evaluate(() => !document.documentElement.hasAttribute('data-motion') && !document.documentElement.hasAttribute('data-hero')));
  t.check('smooth scroll is not started', !(await calm.evaluate(() => document.documentElement.classList.contains('lenis'))));
  t.check('the 3D scene is not started, and there is no Pause control to need', (await calm.$('[data-testid=hero-stage] canvas')) === null && (await calm.$('[data-testid=hero-pause]')) === null);
  t.check('and every section is fully visible', (await hidden(calm)).length === 0 && (await calm.$$eval('[data-testid=row-new-arrivals] li', (l) => l.length)) > 0);
  t.check('layout is stable with reduced motion (CLS < 0.1)', (await calm.evaluate(() => window.__cls)) < 0.1);
  await calm.close();

  const bare = await newPage(browser, stack, { isolated: true });
  await bare.setJavaScriptEnabled(false);
  await bare.goto(stack.web + '/', { waitUntil: 'load' });
  await sleep(1500);
  t.check('with JavaScript off the headline, buttons and product rows are all there and visible', /Woven in tradition/.test(await text(bare, 'h1')) && (await bare.$$eval('a[href^="/product/"]', (a) => a.length)) > 0 && (await hidden(bare)).length === 0, (await hidden(bare)).join(', '));
  await bare.close();

  // ────────────────────────────────────────────────────────────────────────
  t.section('Home: page transitions and newsletter band');
  const nav = await newPage(browser, stack, { isolated: true });
  await goto(nav, stack, '/');
  await hydrated(nav, '#newsletter-band-email');
  t.check('the first page of a visit does not fade in (initial load is untouched)', await nav.evaluate(() => document.querySelector('.page-in') === null));
  await clickText(nav, /^Returns & refunds$/, { selector: 'footer a' });
  await nav.waitForFunction(() => location.pathname === '/returns', { timeout: 15_000 });
  t.check('navigating to another page eases it in', await nav.waitForFunction(() => document.querySelector('.page-in') !== null, { timeout: 5000 }).then(() => true, () => false));
  t.check('the policy page quotes the live return window', new RegExp(`${settings.returns.returnWindowDays} days`).test(await text(nav, '[data-testid=returns-window]')));
  await goto(nav, stack, '/shipping');
  t.check('the shipping page quotes the live delivery charges', /free|₹/i.test(await text(nav, '[data-testid=shipping-rates]')));
  for (const path of ['/privacy', '/terms', '/contact']) {
    await goto(nav, stack, path);
    t.check(`${path} loads with a heading and no error`, (await nav.$eval('h1', (h) => h.textContent.trim().length > 0)) && nav.__errors.length === 0, nav.__errors.join(' | ').slice(0, 120));
  }
  t.check('the footer links to every policy', await nav.$$eval('footer a', (a) => ['/shipping', '/returns', '/privacy', '/terms', '/contact'].every((h) => a.some((x) => x.getAttribute('href') === h))));
  t.check('the footer invents no contact details or social links when none are configured', (await nav.$$eval('footer a[href^="mailto:"], footer a[href^="tel:"], footer [aria-label="Social media"] a', (a) => a.length)) === 0);

  await goto(nav, stack, '/');
  await hydrated(nav, '#newsletter-band-email');
  await nav.type('#newsletter-band-email', 'band@example.test');
  await clickText(nav, /^Subscribe$/, { selector: '[data-testid=newsletter-band] button' });
  await t.attempt('the newsletter band on the home page subscribes an address', async () => {
    await nav.waitForFunction(() => document.querySelector('[data-testid=newsletter-band] [data-testid=newsletter-done]'), { timeout: 12_000 });
  });
  t.check('the footer’s own form still has its own, distinct field', (await nav.$('#newsletter-email')) !== null);
  await nav.close();
}
