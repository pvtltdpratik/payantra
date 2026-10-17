import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
export const artifacts = join(here, '..', 'artifacts');

function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome/Edge found. Set BROWSER_PATH to a Chromium-based browser.');
  return found;
}

export async function launchBrowser() {
  mkdirSync(artifacts, { recursive: true });
  return puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox'] });
}

/**
 * Razorpay Checkout normally loads from checkout.razorpay.com and talks to the bank. In tests that
 * script is replaced by a shim with the same surface (`new Razorpay(opts).open()` → handler /
 * ondismiss / payment.failed). The shim performs the "payment" against the mock Razorpay, which
 * returns a genuine HMAC signature — so everything AFTER the click is real code.
 *
 * Choose the outcome per test with `await page.evaluate(() => (window.__rzp.outcome = 'failed'))`
 * ('captured' | 'failed' | 'dismiss').
 */
export const razorpayShim = (simBase) => `
(function () {
  window.__rzp = { outcome: 'captured', opened: 0, lastOptions: null };
  window.Razorpay = function (options) {
    var self = this;
    this.handlers = {};
    this.on = function (event, cb) { self.handlers[event] = cb; };
    this.open = function () {
      window.__rzp.opened += 1;
      window.__rzp.lastOptions = { order_id: options.order_id, amount: options.amount, key: options.key, currency: options.currency };
      var outcome = window.__rzp.outcome;
      if (outcome === 'dismiss') {
        setTimeout(function () { options.modal && options.modal.ondismiss && options.modal.ondismiss(); }, 30);
        return;
      }
      fetch(${JSON.stringify(simBase)} + '/pay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order_id: options.order_id, outcome: outcome === 'failed' ? 'failed' : 'captured' })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (outcome === 'failed') {
          self.handlers['payment.failed'] && self.handlers['payment.failed']({ error: { description: 'Payment failed at the bank' } });
        } else {
          options.handler({ razorpay_order_id: j.razorpay_order_id, razorpay_payment_id: j.razorpay_payment_id, razorpay_signature: j.razorpay_signature });
        }
      });
    };
  };
})();`;

/**
 * `isolated` gives the page its own cookie jar. Pages of one browser context share sessions, so two people
 * signed in at the same time (an admin and a shopper) MUST NOT share a context.
 */
export async function newPage(browser, stack, { mobile = false, isolated = false } = {}) {
  const owner = isolated ? await browser.createBrowserContext() : null;
  const page = await (owner ?? browser).newPage();
  if (owner) {
    const close = page.close.bind(page);
    page.close = async (...a) => {
      await close(...a).catch(() => undefined);
      await owner.close().catch(() => undefined);
    };
  }
  await page.setViewport(mobile ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1280, height: 900 });
  page.setDefaultTimeout(20_000);
  // A tab that is not in front never fires requestAnimationFrame, and puppeteer's waitForFunction polls
  // on rAF by default — so a spec that opens a second page would hang the first. Poll on a timer instead.
  const waitForFunction = page.waitForFunction.bind(page);
  page.waitForFunction = (fn, options = {}, ...args) => waitForFunction(fn, { polling: 100, ...options }, ...args);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().startsWith('https://checkout.razorpay.com/')) {
      return req.respond({ status: 200, contentType: 'application/javascript', body: razorpayShim(stack.razorpay.simBase) });
    }
    // Fonts/analytics from the public internet are irrelevant to the test and may be unreachable.
    if (/^https?:\/\/(fonts\.(googleapis|gstatic)\.com)/.test(req.url())) return req.abort();
    return req.continue();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Aborted font requests (above) and expected 4xx probes are not application errors.
    if (/Failed to load resource/.test(t) && /(401|403|404)/.test(t)) return;
    if (/ERR_FAILED|net::ERR/.test(t)) return;
    errors.push(`console: ${t}`);
  });
  // window.confirm() freezes the page until answered. Accept by default and record what was asked, so a
  // spec can assert on the wording (page.__dialogs) and decline when it needs to (page.__declineNext = true).
  page.__dialogs = [];
  page.on('dialog', (d) => {
    page.__dialogs.push(d.message());
    if (page.__declineNext) {
      page.__declineNext = false;
      return void d.dismiss();
    }
    return void d.accept();
  });
  page.__errors = errors;
  return page;
}

export const settle = async (page, ms = 300) => {
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 8000 }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, ms));
};

export async function goto(page, stack, path) {
  await page.bringToFront();
  await page.goto(stack.web + path, { waitUntil: 'load', timeout: 45_000 });
  await settle(page);
}

/** Signs in through the real login form. */
export async function login(page, stack, who) {
  const a = stack.accounts[who];
  await goto(page, stack, '/auth/login');
  await page.type('#email', a.email);
  await page.type('#password', a.password);
  try {
    await Promise.all([page.waitForFunction(() => location.pathname !== '/auth/login', { timeout: 20_000 }), page.click('button[type=submit]')]);
  } catch (err) {
    const shown = await page.$$eval('[role=alert]', (els) => els.map((e) => e.textContent.trim()).join(' | ')).catch(() => '');
    const why = err.message.split('\n')[0];
    throw new Error(`signing in as ${who} did not leave the login page${shown ? ` — page says: ${shown}` : ''} (${why})`);
  }
  await settle(page);
}

/** Replaces a field's content the way a person would: focus, select all, delete, then type. */
export async function fill(page, selector, value) {
  await page.bringToFront();
  await page.focus(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (value) await page.type(selector, value);
}

export const text = (page, selector = 'body') => page.$eval(selector, (e) => e.innerText);
export const texts = (page, selector) => page.$$eval(selector, (els) => els.map((e) => e.textContent.trim()));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Clicks the first button/link whose visible text matches. */
export async function clickText(page, pattern, { selector = 'button, a', timeout = 10_000 } = {}) {
  await page.bringToFront(); // hidden tabs have no layout events: scrollIntoView/click would hang
  const handle = await page.waitForFunction(
    (sel, src, flags) => {
      const re = new RegExp(src, flags);
      return [...document.querySelectorAll(sel)].find((el) => re.test(el.textContent.trim()) && !el.disabled && el.offsetParent !== null) ?? null;
    },
    { timeout },
    selector,
    pattern.source,
    pattern.flags,
  );
  await handle.asElement().click();
  return handle;
}

/** Fills the input/select inside the <label> whose text matches (the way a person finds a field). */
export async function fillLabel(page, pattern, value, { scope = 'body' } = {}) {
  await page.bringToFront();
  const handle = await page.evaluateHandle(
    (sel, src, flags) => {
      const re = new RegExp(src, flags);
      const label = [...document.querySelector(sel).querySelectorAll('label')].find((l) => re.test(l.textContent.trim()));
      return label?.querySelector('input:not([type=checkbox]), select, textarea') ?? null;
    },
    scope,
    pattern.source,
    pattern.flags,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`no field labelled ${pattern}`);
  const tag = await el.evaluate((e) => e.tagName);
  if (tag === 'SELECT') {
    await el.select(value);
    return;
  }
  await el.focus();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (value) await el.type(value);
}
