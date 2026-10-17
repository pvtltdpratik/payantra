import { clickText, fill, fillLabel, goto, login, newPage, settle, sleep, text } from '../lib/browser.mjs';

/** The Phase 2 admin screens (categories, products, inventory, users), driven with a real signed-in admin. */
export async function run({ stack, browser, t }) {
  const api = (who, method, path, body) => stack.apiAs(who, method, path, body);
  const admin = await newPage(browser, stack, { isolated: true });
  await login(admin, stack, 'admin');
  const visitor = await newPage(browser, stack, { isolated: true }); // never signed in

  const poll = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v || Date.now() > end) return v;
      await sleep(250);
    }
  };
  const alertText = () => admin.$$eval('[role=alert],[role=status]', (e) => e.map((x) => x.textContent.trim()).join(' | '));

  t.section('Admin: categories');
  {
    await goto(admin, stack, '/admin/categories');
    await fillLabel(admin, /^New category name/, 'E2E Stoles');
    await clickText(admin, /^Add$/);
    await t.attempt('a new category appears in the list', async () => {
      await admin.waitForFunction(() => /E2E Stoles/.test(document.body.innerText), { timeout: 10_000 });
    });
    const cats = (await api('admin', 'GET', '/admin/categories')).body.data;
    const made = cats.find((c) => c.name === 'E2E Stoles');
    t.check('the server stored it with a slug', made?.slug === 'e2e-stoles', made?.slug);

    const dup = await api('admin', 'POST', '/admin/categories', { name: 'E2E Stoles' });
    t.check('a duplicate name is allowed but gets its own slug', dup.status === 201 && dup.body.data.slug === 'e2e-stoles-2', `HTTP ${dup.status} ${dup.body?.data?.slug}`);
  }

  let product;
  t.section('Admin: creating a product');
  {
    await goto(admin, stack, '/admin/products/new');
    await clickText(admin, /^Create product$/);
    await t.attempt('an empty form is rejected with field errors', async () => {
      await admin.waitForFunction(() => document.querySelectorAll('[role=alert], [aria-invalid=true]').length > 0, { timeout: 5000 });
    });

    await fill(admin, '#name', 'E2E Linen Stole');
    await fill(admin, '#description', 'A featherweight linen stole woven for the end-to-end test suite, with a hand-rolled hem.');
    const catId = await admin.evaluate(() => [...document.querySelectorAll('#categoryId option')].find((o) => /E2E Stoles/.test(o.textContent))?.value);
    await admin.select('#categoryId', catId);
    await fill(admin, '#fabric', 'Linen');
    await fill(admin, '#occasion', 'Casual');
    await fill(admin, '#careNotes', 'Hand wash cold.');
    await fill(admin, '#hsnCode', '6214');
    await fill(admin, '#basePrice', '1999');
    await fill(admin, '#salePrice', '1499');
    await admin.select('#status', 'ACTIVE');
    await fill(admin, '[id="images.0.url"]', '/placeholder/c8a96a?label=E2E+Stole&v=1');
    await fill(admin, '[id="images.0.alt"]', 'E2E linen stole in sand');
    await fill(admin, '#v0-sku', 'E2E-STOLE-SAND');
    await fill(admin, '#v0-size', 'Free');
    await fill(admin, '#v0-colour', 'Sand');
    await fill(admin, '#v0-stock', '12');
    await clickText(admin, /^Create product$/);
    await admin.waitForFunction(() => /^\/admin\/products\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 }).catch(() => undefined);
    const ok = /^\/admin\/products\/[0-9a-f-]{36}$/.test(new URL(admin.url()).pathname);
    t.check('submitting the form creates the product and opens its editor', ok, ok ? admin.url() : await alertText());
    if (!ok) return;
    await settle(admin);

    const id = new URL(admin.url()).pathname.split('/').pop();
    product = (await api('admin', 'GET', `/admin/products/${id}`)).body.data;
    t.check('prices are stored in paise', product.basePrice === 199_900 && product.salePrice === 149_900, `${product.basePrice}/${product.salePrice}`);
    t.check('the variant starts with 12 units', product.variants?.[0]?.sku === 'E2E-STOLE-SAND' && product.variants[0].inventory?.onHand === 12, JSON.stringify(product.variants?.[0]));
  }

  t.section('Storefront reflects admin changes');
  {
    await goto(visitor, stack, `/product/${product.slug}`);
    t.check('an Active product is public', (await text(visitor, 'h1')).includes('E2E Linen Stole'));
    t.check('…at the sale price', /1,499/.test(await text(visitor)));
    await goto(visitor, stack, '/search?q=Linen%20Stole');
    t.check('and found by search', (await text(visitor)).includes('E2E Linen Stole'));

    // Edit the price in the admin UI.
    await goto(admin, stack, `/admin/products/${product.id}`);
    await fill(admin, '#salePrice', '1299');
    await clickText(admin, /^Save changes$/);
    await t.attempt('saving shows "Product saved."', async () => {
      await admin.waitForFunction(() => /Product saved/.test(document.body.innerText), { timeout: 10_000 });
    });
    const fresh = await poll(async () => (await api('admin', 'GET', `/admin/products/${product.id}`)).body.data.salePrice === 129_900);
    t.check('the new price is stored', fresh);
    const pub = (await (await fetch(`${stack.api}/products/${product.slug}`)).json()).data;
    t.check('the public API serves the new price at once', pub.price === 129_900, `${pub.price}`);
    // Storefront pages are cached for a minute or so (cacheLife "minutes"), so a visitor may still SEE the old
    // price briefly — which is safe only because the server decides what is charged. Prove that.
    const cart = await api('alice', 'POST', '/cart/items', { variantId: product.variants[0].id, quantity: 1 });
    t.check('a cart prices the item at the NEW price, whatever the page showed', cart.body?.data?.items?.[0]?.unitPrice === 129_900, JSON.stringify(cart.body?.data?.items?.[0]));
    await api('alice', 'DELETE', '/cart');
  }

  t.section('Admin: inventory');
  {
    await goto(admin, stack, '/admin/inventory?q=E2E-STOLE');
    const found = await admin.evaluate(() => [...document.querySelectorAll('tr')].some((r) => /E2E-STOLE-SAND/.test(r.textContent)));
    t.check('the new variant is on the inventory screen', found);

    // Open its Adjust dialog.
    await admin.evaluate(() => {
      const row = [...document.querySelectorAll('tr')].find((r) => /E2E-STOLE-SAND/.test(r.textContent));
      [...row.querySelectorAll('button')].find((b) => /^Adjust$/.test(b.textContent.trim())).click();
    });
    await admin.waitForSelector('[role=dialog]');
    await fillLabel(admin, /^Units/, '-9', { scope: '[role=dialog]' });
    await t.attempt('a reason is required', async () => {
      const disabled = await admin.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => /Save adjustment/.test(b.textContent)).disabled);
      if (!disabled) throw new Error('submit enabled without a reason');
    });
    await fillLabel(admin, /^Reason/, 'Damaged in the e2e warehouse', { scope: '[role=dialog]' });
    await clickText(admin, /^Save adjustment$/, { selector: '[role=dialog] button' });
    const stock = await poll(async () => (await api('admin', 'GET', `/admin/products/${product.id}`)).body.data.variants[0].inventory.onHand === 3);
    t.check('on-hand is now 3', stock);

    const pub = await (await fetch(`${stack.api}/products/${product.slug}`)).json();
    t.check('the public API reports 3 available', pub.data.variants[0].available === 3, `${pub.data.variants[0].available}`);

    const over = await api('admin', 'POST', `/admin/inventory/${product.variants[0].id}/adjust`, { mode: 'delta', quantity: -50, reason: 'too many' });
    t.check('removing more than exists is refused', over.status >= 400 && over.status < 500, `HTTP ${over.status}`);
  }

  t.section('Archiving hides a product');
  {
    await goto(admin, stack, `/admin/products/${product.id}`);
    await admin.select('#status', 'ARCHIVED');
    await clickText(admin, /^Save changes$/);
    await admin.waitForFunction(() => /Product saved/.test(document.body.innerText), { timeout: 10_000 }).catch(() => undefined);
    const gone = await poll(async () => (await fetch(`${stack.api}/products/${product.slug}`)).status === 404);
    t.check('the public API now returns 404', gone);
    // The cached storefront page may linger for a minute; what must hold is that nobody can BUY it.
    const buy = await api('alice', 'POST', '/cart/items', { variantId: product.variants[0].id, quantity: 1 });
    t.check('an archived product cannot be added to a bag, even from a stale page', buy.status >= 400 && buy.status < 500, `HTTP ${buy.status}`);
    const listed = (await (await fetch(`${stack.api}/products?q=Linen%20Stole`)).json()).data;
    t.check('and search no longer lists it', !listed.some((p) => p.slug === product.slug));
  }

  t.section('Admin: users and roles');
  {
    await api('bob', 'GET', '/users/me'); // a profile is created on first sign-in
    await goto(admin, stack, '/admin/users');
    const self = `select[aria-label="Role for ${stack.accounts.admin.email}"]`;
    t.check('an admin cannot change their own role', await admin.$eval(self, (s) => s.disabled));

    const bob = `select[aria-label="Role for ${stack.accounts.bob.email}"]`;
    await admin.select(bob, 'DELIVERY_PARTNER');
    const promoted = await poll(async () => (await api('bob', 'GET', '/users/me')).body?.data?.role === 'DELIVERY_PARTNER');
    t.check('changing a role in the UI changes it on the server', promoted);
    t.check('the UI asked for confirmation first', admin.__dialogs.some((m) => /Change .*bob@payantra.test.* to Delivery/i.test(m)), admin.__dialogs.join(' | '));
    const noAdmin = await api('bob', 'GET', '/admin/orders');
    t.check('a delivery partner still cannot use admin routes', noAdmin.status === 403, `HTTP ${noAdmin.status}`);

    await admin.select(bob, 'CUSTOMER');
    await poll(async () => (await api('bob', 'GET', '/users/me')).body?.data?.role === 'CUSTOMER');

    await admin.select(`select[aria-label="Status for ${stack.accounts.bob.email}"]`, 'SUSPENDED');
    const suspended = await poll(async () => (await api('bob', 'GET', '/users/me')).status === 403);
    t.check('suspending an account blocks its API access immediately', suspended);
    await admin.select(`select[aria-label="Status for ${stack.accounts.bob.email}"]`, 'ACTIVE');
    t.check('and reactivating restores it', await poll(async () => (await api('bob', 'GET', '/users/me')).status === 200));
  }

  await visitor.close();
  await admin.close();
}
