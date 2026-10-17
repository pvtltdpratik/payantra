import { clickText, fill, goto, login, newPage, settle, sleep, text } from '../lib/browser.mjs';

export async function run({ stack, browser, t }) {
  const mailbox = async (email, type) => (await (await fetch(`${stack.supabase.url}/__mock/mailbox?email=${encodeURIComponent(email)}`)).json()).filter((m) => m.type === type).at(-1);

  t.section('Registration with email verification');
  {
    const page = await newPage(browser, stack);
    const email = 'newshopper@payantra.test';
    await goto(page, stack, '/auth/register');
    await page.type('#fullName', 'Meera Kulkarni');
    await page.type('#email', email);
    await page.type('#password', 'Silk2026pass');
    await page.type('#confirmPassword', 'Silk2026pass');
    await page.click('button[type=submit]');
    await t.attempt('shows "check your inbox" after signing up', async () => {
      await page.waitForFunction(() => /Check your inbox/i.test(document.body.innerText), { timeout: 15_000 });
    });

    const mail = await mailbox(email, 'signup');
    t.check('a confirmation email was sent', !!mail?.link, mail?.link?.slice(0, 60));

    // The account exists but cannot sign in until the address is confirmed.
    const early = await newPage(browser, stack);
    await goto(early, stack, '/auth/login');
    await early.type('#email', email);
    await early.type('#password', 'Silk2026pass');
    await early.click('button[type=submit]');
    await t.attempt('refuses sign-in before the email is confirmed', async () => {
      await early.waitForFunction(() => /confirm your email/i.test(document.body.innerText), { timeout: 10_000 });
    });
    await early.close();

    // Following the emailed link signs the shopper in and lands on their account.
    await page.goto(mail.link, { waitUntil: 'load' });
    await settle(page);
    t.check('the confirmation link lands on /account, signed in', new URL(page.url()).pathname === '/account', page.url());
    t.check('the account page shows the shopper’s email', (await text(page)).includes(email));
    t.check('the profile picked up the name from sign-up', await page.$eval('#fullName', (e) => e.value) === 'Meera Kulkarni');

    // Sign out clears the session.
    await clickText(page, /^Sign out$/);
    await page.waitForFunction(() => location.pathname === '/', { timeout: 15_000 });
    await settle(page);
    await goto(page, stack, '/account');
    t.check('after sign-out /account sends you to sign in', new URL(page.url()).pathname === '/auth/login', page.url());
    await page.close();
  }

  t.section('Sign-in');
  {
    const page = await newPage(browser, stack);
    await goto(page, stack, '/auth/login');
    await page.type('#email', stack.accounts.alice.email);
    await page.type('#password', 'wrong-password');
    await page.click('button[type=submit]');
    await t.attempt('a wrong password gets one generic message', async () => {
      await page.waitForFunction(() => /Incorrect email or password/i.test(document.body.innerText), { timeout: 10_000 });
    });

    await fill(page, '#password', stack.accounts.alice.password);
    await Promise.all([page.waitForFunction(() => location.pathname === '/account', { timeout: 15_000 }), page.click('button[type=submit]')]);
    await settle(page);
    t.check('the right password signs in and lands on /account', new URL(page.url()).pathname === '/account');
    const header = await text(page, 'header');
    t.check('the header now shows the account menu instead of "Sign in"', /Account/.test(header) && !/Sign in/.test(header), header.replace(/\s+/g, ' ').slice(0, 80));

    // The "next" page is honoured after signing in.
    await clickText(page, /^Sign out$/);
    await page.waitForFunction(() => location.pathname === '/');
    await settle(page);
    await goto(page, stack, '/wishlist');
    t.check('a protected page remembers where you were going', new URL(page.url()).searchParams.get('next') === '/wishlist', page.url());
    await page.type('#email', stack.accounts.alice.email);
    await page.type('#password', stack.accounts.alice.password);
    await Promise.all([page.waitForFunction(() => location.pathname === '/wishlist', { timeout: 15_000 }), page.click('button[type=submit]')]);
    t.check('and returns you there after signing in', new URL(page.url()).pathname === '/wishlist');
    await page.close();
  }

  t.section('Password reset');
  {
    const page = await newPage(browser, stack);
    const email = stack.accounts.bob.email;
    await goto(page, stack, '/auth/forgot-password');
    await page.type('#email', email);
    await page.click('button[type=submit]');
    await t.attempt('says a link is on its way', async () => {
      await page.waitForFunction(() => /reset link is on its way/i.test(document.body.innerText), { timeout: 15_000 });
    });

    // An unknown address gets exactly the same answer (no account enumeration).
    const probe = await newPage(browser, stack);
    await goto(probe, stack, '/auth/forgot-password');
    await probe.type('#email', 'nobody-here@payantra.test');
    await probe.click('button[type=submit]');
    await t.attempt('gives the identical answer for an unknown address', async () => {
      await probe.waitForFunction(() => /reset link is on its way/i.test(document.body.innerText), { timeout: 15_000 });
    });
    t.check('…and sends no email for it', !(await mailbox('nobody-here@payantra.test', 'recovery')));
    await probe.close();

    const mail = await mailbox(email, 'recovery');
    t.check('a recovery email was sent to the real account', !!mail?.link);
    await page.goto(mail.link, { waitUntil: 'load' });
    await settle(page);
    t.check('the recovery link opens the "choose a new password" page', new URL(page.url()).pathname === '/auth/reset-password', page.url());

    await page.type('#password', 'short');
    await page.type('#confirmPassword', 'different1');
    await page.click('button[type=submit]');
    await sleep(300);
    t.check('a weak or mismatched password is rejected before submitting', /at least 8|do not match/i.test(await text(page)));

    await fill(page, '#password', 'Brocade2026new');
    await fill(page, '#confirmPassword', 'Brocade2026new');
    await page.click('button[type=submit]');
    // The earlier mismatched submit left an alert on screen, so wait for the NAVIGATION itself and only
    // read the alert text if it never happens.
    await page.waitForFunction(() => location.pathname === '/account', { timeout: 15_000 }).catch(() => undefined);
    const alertText = await page.$$eval('[role=alert]', (els) => els.map((e) => e.textContent.trim()).join(' | ')).catch(() => '');
    t.check('setting the new password signs you in', new URL(page.url()).pathname === '/account', alertText || page.url());
    await clickText(page, /^Sign out$/);
    await page.waitForFunction(() => location.pathname === '/');

    // The old password no longer works; the new one does.
    stack.accounts.bob.password = 'Brocade2026new';
    await goto(page, stack, '/auth/login');
    await page.type('#email', email);
    await page.type('#password', 'Bob#2026pass');
    await page.click('button[type=submit]');
    await t.attempt('the OLD password is rejected', async () => {
      await page.waitForFunction(() => /Incorrect email or password/i.test(document.body.innerText), { timeout: 10_000 });
    });
    await page.close();
    const again = await newPage(browser, stack);
    await login(again, stack, 'bob');
    t.check('the NEW password signs in', new URL(again.url()).pathname === '/account');
    await again.close();
  }

  t.section('Route protection');
  {
    // Pages in one browser context share cookies, and earlier sections left people signed in:
    // "anonymous" needs a context of its own.
    const anon = await browser.createBrowserContext();
    const page = await newPage(anon, stack);
    for (const path of ['/cart', '/checkout', '/wishlist', '/account/orders', '/account/addresses', '/admin/orders', '/admin/products']) {
      await goto(page, stack, path);
      const u = new URL(page.url());
      t.check(`anonymous ${path} → sign-in with next`, u.pathname === '/auth/login' && u.searchParams.get('next') === path, page.url());
    }
    await page.close();
    await anon.close();

    // A signed-in CUSTOMER is not an admin: the admin area bounces them and the API refuses them.
    const cust = await newPage(browser, stack);
    await login(cust, stack, 'alice');
    await goto(cust, stack, '/admin/orders');
    t.check('a customer opening /admin/orders is sent away', new URL(cust.url()).pathname === '/', cust.url());
    t.check('…and sees none of the admin interface', !/Users & roles/.test(await text(cust)));
    await cust.close();

    const forbidden = await stack.apiAs('alice', 'GET', '/admin/orders');
    t.check('the API itself returns 403 for a customer on admin routes', forbidden.status === 403, `HTTP ${forbidden.status}`);
    const anonymous = await fetch(`${stack.api}/admin/orders`);
    t.check('and 401 with no token at all', anonymous.status === 401, `HTTP ${anonymous.status}`);
    const forged = await fetch(`${stack.api}/admin/orders`, { headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.forged' } });
    t.check('and 401 for a forged token', forged.status === 401, `HTTP ${forged.status}`);
  }
}
