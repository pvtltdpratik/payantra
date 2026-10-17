import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { artifacts, goto, login, newPage, settle } from '../lib/browser.mjs';

/**
 * Phone-width pass (390×844, touch). The check is the one that matters most on a small screen: the page must
 * never scroll sideways. When it does, the report names the widest offending element.
 */
export async function run({ stack, browser, t }) {
  mkdirSync(artifacts, { recursive: true });
  const api = (who, method, path, body) => stack.apiAs(who, method, path, body);

  // Give the shopper something in the bag and an address, so cart/checkout render their full layouts.
  const list = (await (await fetch(`${stack.api}/products?pageSize=24`)).json()).data;
  let variantId;
  let slug;
  for (const item of list) {
    const d = (await (await fetch(`${stack.api}/products/${item.slug}`)).json()).data;
    const v = d.variants.find((x) => x.available >= 2);
    if (v) {
      variantId = v.id;
      slug = d.slug;
      break;
    }
  }
  await api('alice', 'DELETE', '/cart');
  await api('alice', 'POST', '/cart/items', { variantId, quantity: 2 });
  if (((await api('alice', 'GET', '/addresses')).body.data ?? []).length === 0) {
    await api('alice', 'POST', '/addresses', { fullName: 'Alice Rao', phone: '9876543210', line1: '12 Lotus Apartments, MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001', isDefault: true });
  }
  const orders = (await api('alice', 'GET', '/orders')).body.data ?? [];

  const overflow = (page) =>
    page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const doc = document.documentElement.scrollWidth;
      if (doc <= vw + 1) return null;
      let worst = null;
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 && r.width > 0 && (!worst || r.right > worst.right)) worst = { right: Math.round(r.right), tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), text: (el.textContent || '').trim().slice(0, 30) };
      }
      return { vw, doc, worst };
    });

  const pass = async (who, title, pages) => {
    t.section(title);
    const page = await newPage(browser, stack, { mobile: true, isolated: true });
    if (who) await login(page, stack, who);
    for (const [name, path] of pages) {
      await goto(page, stack, path);
      await settle(page, 600);
      const o = await overflow(page);
      const landed = new URL(page.url()).pathname;
      t.check(`${name} (${path}) fits a phone screen`, !o, o ? `page is ${o.doc}px wide in a ${o.vw}px viewport; widest: <${o.worst?.tag}> "${o.worst?.text}" ${o.worst?.cls}` : landed !== path.split('?')[0] ? `(landed on ${landed})` : '');
      await page.screenshot({ path: join(artifacts, `mobile-${who ?? 'visitor'}-${name.replace(/\W+/g, '-').toLowerCase()}.png`) });
    }
    return page;
  };

  const visitor = await pass(null, 'Phone: public pages', [
    ['home', '/'],
    ['shop', '/shop'],
    ['search', '/search?q=saree'],
    ['product', `/product/${slug}`],
    ['sign in', '/auth/login'],
    ['register', '/auth/register'],
  ]);
  // The navigation must be reachable without a desktop-width header.
  await goto(visitor, stack, '/');
  const menu = await visitor.$$eval('button', (b) => b.map((x) => (x.getAttribute('aria-label') || x.textContent || '').trim()).filter((s) => /menu/i.test(s)));
  t.check('the header offers a menu button on a phone', menu.length > 0, menu.join(', '));
  await visitor.close();

  const shopper = await pass('alice', 'Phone: shopper pages', [
    ['bag', '/cart'],
    ['checkout', '/checkout'],
    ['wishlist', '/wishlist'],
    ['account', '/account'],
    ['addresses', '/account/addresses'],
    ['orders', '/account/orders'],
    ['reviews', '/account/reviews'],
    ['notifications', '/account/notifications'],
    ['help & support', '/account/support'],
    ['security', '/account/security'],
    ...(orders[0] ? [['order detail', `/account/orders/${orders[0].id}`], ['invoice', `/account/orders/${orders[0].id}/invoice`]] : []),
  ]);
  await shopper.close();
  await api('alice', 'DELETE', '/cart');

  const riderPages = [['today', '/delivery'], ['history', '/delivery/history'], ['apply', '/delivery/apply']];
  const rider = await pass('rider', 'Phone: delivery pages', riderPages);
  await rider.close();

  const admin = await pass('admin', 'Phone: admin pages', [
    ['orders', '/admin/orders'],
    ...(orders[0] ? [['order detail', `/admin/orders/${orders[0].id}`]] : []),
    ['returns', '/admin/returns'],
    ['products', '/admin/products'],
    ['new product', '/admin/products/new'],
    ['inventory', '/admin/inventory'],
    ['categories', '/admin/categories'],
    ['coupons', '/admin/coupons'],
    ['users', '/admin/users'],
    ['settings', '/admin/settings'],
    ['overview', '/admin'],
    ['reports', '/admin/analytics?report=sales'],
    ['customers', '/admin/customers'],
    ['support', '/admin/support'],
    ['banners', '/admin/banners'],
    ['newsletter', '/admin/newsletter'],
    ['reviews', '/admin/reviews'],
    ['audit log', '/admin/audit'],
    ['delivery partners', '/admin/delivery-partners'],
  ]);
  await admin.close();
}
