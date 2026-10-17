/**
 * A stand-in for the parts of Supabase Auth (GoTrue) that Payantra uses, for end-to-end tests and
 * offline development. It is NOT a security component and must never run in production.
 *
 * What is real: tokens are genuine RS256 JWTs signed with a freshly generated key, and the matching
 * JWKS is published at /auth/v1/.well-known/jwks.json — so the API verifies them through its normal
 * production code path (signature, issuer, audience, expiry). Only the issuer URL is different, and
 * that is ordinary configuration (SUPABASE_URL).
 *
 * Implemented: password sign-in, PKCE code exchange, refresh, user lookup/update, sign-up and
 * password-recovery with an inspectable "mailbox", sign-out. Not implemented: OAuth providers.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair, jwtVerify } from 'jose';

export async function startMockSupabase({ port = 0 } = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('The mock Supabase server must never run in production.');

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'mock-key-1', alg: 'RS256', use: 'sig' };

  let base = '';
  const users = new Map(); // id → record
  const refreshTokens = new Map(); // token → userId
  const codes = new Map(); // one-time PKCE code → userId
  const links = new Map(); // email-link token → { userId, type, redirectTo }
  const mailbox = []; // what "emails" were sent

  const byEmail = (email) => [...users.values()].find((u) => u.email === String(email).toLowerCase());
  const publicUser = (u) => ({
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: u.confirmed ? u.createdAt : null,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: u.metadata,
    identities: [],
    created_at: u.createdAt,
    updated_at: u.createdAt,
  });

  async function sessionFor(u) {
    const now = Math.floor(Date.now() / 1000);
    const access_token = await new SignJWT({
      email: u.email,
      role: 'authenticated',
      aal: 'aal1',
      session_id: randomUUID(),
      user_metadata: u.metadata,
      app_metadata: { provider: 'email', providers: ['email'] },
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'mock-key-1' })
      .setSubject(u.id)
      .setIssuer(`${base}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);
    const refresh_token = randomBytes(12).toString('hex');
    refreshTokens.set(refresh_token, u.id);
    return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token, user: publicUser(u) };
  }

  async function userFromBearer(req) {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '');
    try {
      const { payload } = await jwtVerify(token, publicKey, { issuer: `${base}/auth/v1`, audience: 'authenticated' });
      return users.get(payload.sub) ?? null;
    } catch {
      return null;
    }
  }

  const readBody = (req) =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const path = url.pathname;
    const origin = req.headers.origin;

    // The browser calls this server cross-origin (the app runs on another port).
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, x-supabase-api-version');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const fail = (status, error_code, msg) => send(status, { code: status, error_code, msg });

    if (req.method === 'OPTIONS') return send(204);
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};

    // ── test controls ──
    if (path === '/__mock/users' && req.method === 'POST') {
      const email = String(body.email).toLowerCase();
      if (byEmail(email)) return send(200, { id: byEmail(email).id, existed: true });
      const u = { id: body.id ?? randomUUID(), email, password: body.password, confirmed: body.confirmed ?? true, metadata: body.fullName ? { full_name: body.fullName } : {}, createdAt: new Date().toISOString() };
      users.set(u.id, u);
      return send(200, { id: u.id });
    }
    if (path === '/__mock/mailbox') return send(200, mailbox.filter((m) => !url.searchParams.get('email') || m.to === url.searchParams.get('email').toLowerCase()));
    if (path === '/__mock/token' && req.method === 'POST') {
      const u = byEmail(body.email);
      return u ? send(200, { access_token: (await sessionFor(u)).access_token, id: u.id }) : fail(404, 'user_not_found', 'No such user');
    }
    if (path === '/__mock/reset') {
      users.clear(); refreshTokens.clear(); codes.clear(); links.clear(); mailbox.length = 0;
      return send(200, { ok: true });
    }

    // ── GoTrue ──
    if (path === '/auth/v1/.well-known/jwks.json') return send(200, { keys: [jwk] });

    if (path === '/auth/v1/token' && req.method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const u = byEmail(body.email);
        if (!u || u.password !== body.password) return fail(400, 'invalid_credentials', 'Invalid login credentials');
        if (!u.confirmed) return fail(400, 'email_not_confirmed', 'Email not confirmed');
        return send(200, await sessionFor(u));
      }
      if (grant === 'refresh_token') {
        const id = refreshTokens.get(body.refresh_token);
        const u = id && users.get(id);
        if (!u) return fail(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        refreshTokens.delete(body.refresh_token);
        return send(200, await sessionFor(u));
      }
      if (grant === 'pkce') {
        const id = codes.get(body.auth_code);
        const u = id && users.get(id);
        if (!u) return fail(400, 'flow_state_not_found', 'invalid flow state, no valid flow state found');
        codes.delete(body.auth_code); // single use
        return send(200, await sessionFor(u));
      }
      return fail(400, 'unsupported_grant_type', `Unsupported grant type ${grant}`);
    }

    if (path === '/auth/v1/user') {
      const u = await userFromBearer(req);
      if (!u) return fail(401, 'bad_jwt', 'invalid JWT');
      if (req.method === 'PUT') {
        if (body.password) u.password = body.password;
        if (body.data) u.metadata = { ...u.metadata, ...body.data };
      }
      return send(200, publicUser(u));
    }

    if (path === '/auth/v1/signup' && req.method === 'POST') {
      const email = String(body.email ?? '').toLowerCase();
      if (!email || !body.password || body.password.length < 6) return fail(422, 'weak_password', 'Password should be at least 6 characters.');
      let u = byEmail(email);
      // Real Supabase answers identically for a taken address, so sign-up cannot be used to probe emails.
      if (!u) {
        u = { id: randomUUID(), email, password: body.password, confirmed: false, metadata: body.data ?? {}, createdAt: new Date().toISOString() };
        users.set(u.id, u);
        const token = randomBytes(10).toString('hex');
        const redirectTo = url.searchParams.get('redirect_to') ?? '';
        links.set(token, { userId: u.id, type: 'signup', redirectTo });
        mailbox.push({ to: email, type: 'signup', link: `${base}/auth/v1/verify?token=${token}&type=signup&redirect_to=${encodeURIComponent(redirectTo)}` });
      }
      return send(200, publicUser(u));
    }

    if (path === '/auth/v1/recover' && req.method === 'POST') {
      const u = byEmail(body.email);
      if (u) {
        const token = randomBytes(10).toString('hex');
        const redirectTo = url.searchParams.get('redirect_to') ?? '';
        links.set(token, { userId: u.id, type: 'recovery', redirectTo });
        mailbox.push({ to: u.email, type: 'recovery', link: `${base}/auth/v1/verify?token=${token}&type=recovery&redirect_to=${encodeURIComponent(redirectTo)}` });
      }
      return send(200, {}); // same answer whether or not the account exists
    }

    if (path === '/auth/v1/verify' && req.method === 'GET') {
      const link = links.get(url.searchParams.get('token'));
      if (!link) return fail(400, 'otp_expired', 'Email link is invalid or has expired');
      links.delete(url.searchParams.get('token'));
      const u = users.get(link.userId);
      u.confirmed = true;
      const code = randomBytes(12).toString('hex');
      codes.set(code, u.id);
      const target = new URL(link.redirectTo || `${base}/`);
      target.searchParams.set('code', code);
      res.writeHead(302, { Location: target.toString() });
      return res.end();
    }

    if (path === '/auth/v1/logout') return send(204);
    return fail(404, 'not_found', `No mock route for ${req.method} ${path}`);
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = server.address().port;
  base = `http://127.0.0.1:${actual}`;

  return {
    url: base,
    port: actual,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
