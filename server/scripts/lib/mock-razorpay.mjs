/**
 * A small stand-in for Razorpay's REST API, used by the integration tests and the browser e2e.
 * It implements only what Payantra calls, enforces HTTP Basic auth, and exposes /__sim/* controls
 * so a test can play the customer ("pay", "fail") and inject provider faults.
 *
 * It is NOT a security boundary or a faithful Razorpay simulation: it exists so the real gateway
 * code (auth header, JSON, timeouts, error mapping) and the payment state machine are exercised
 * end to end without network access or live keys.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const rid = (prefix) => `${prefix}_${randomBytes(7).toString('hex')}`;

export async function startMockRazorpay({ keyId, keySecret, port = 0 }) {
  /** @type {Map<string, any>} */ const orders = new Map();
  /** @type {Map<string, any>} */ const payments = new Map();
  /** @type {Map<string, any>} */ const refunds = new Map();
  /** @type {{method: string, path: string}[]} */ let calls = [];
  /** @type {{match: string, status: number, count: number}[]} */ let faults = [];
  /** Faults applied AFTER the request has been fully processed (ambiguous outcome). */
  /** @type {{match: string, status: number, count: number}[]} */ let faultsAfter = [];

  const json = (res, status, body) => {
    // A "fault-after" rule lets the provider PROCESS the request, then fail the reply: the caller sees
    // a 5xx although the work happened — exactly the ambiguity a real timeout creates.
    const rule =
      res.apiPath && status < 400
        ? faultsAfter.find((x) => res.apiPath.includes(x.match) && (!x.method || x.method === res.apiMethod) && x.count > 0)
        : undefined;
    if (rule) {
      rule.count -= 1;
      status = rule.status;
      body = { error: { code: 'SERVER_ERROR', description: 'Simulated timeout after processing' } };
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const err = (res, status, code, description) => json(res, status, { error: { code, description } });
  const readBody = (req) =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => resolve(data ? JSON.parse(data) : {}));
    });

  const signature = (orderId, paymentId) => createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    // The gateway's base URL ends in /v1 (as Razorpay's does); routing below is relative to it.
    const path = url.pathname.startsWith('/__sim/') ? url.pathname : url.pathname.replace(/^\/v1/, '');
    const body = req.method === 'POST' ? await readBody(req) : {};

    // ── Simulation controls (not part of Razorpay) ──
    if (path.startsWith('/__sim/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      if (req.method === 'OPTIONS') return json(res, 204, {});

      if (path === '/__sim/pay') {
        const order = orders.get(body.order_id);
        if (!order) return err(res, 404, 'BAD_REQUEST_ERROR', 'unknown order');
        const outcome = body.outcome ?? 'captured';
        const payment = {
          id: rid('pay'),
          order_id: order.id,
          amount: order.amount,
          currency: order.currency,
          status: outcome === 'failed' ? 'failed' : outcome === 'authorized' ? 'authorized' : 'captured',
          method: body.method ?? 'upi',
          captured: outcome === 'captured',
          amount_refunded: 0,
          error_description: outcome === 'failed' ? (body.error ?? 'Payment failed at the bank') : null,
        };
        payments.set(payment.id, payment);
        order.status = outcome === 'captured' ? 'paid' : 'attempted';
        return json(res, 200, { payment, razorpay_order_id: order.id, razorpay_payment_id: payment.id, razorpay_signature: signature(order.id, payment.id) });
      }
      if (path === '/__sim/fault-after') {
        // The request is PROCESSED by the provider, but the caller gets a 5xx — the classic ambiguous timeout.
        faultsAfter.push({ match: body.match, method: body.method, status: body.status ?? 504, count: body.count ?? 1 });
        return json(res, 200, { ok: true });
      }
      if (path === '/__sim/fault') {
        faults.push({ match: body.match, method: body.method, status: body.status ?? 500, count: body.count ?? 1 });
        return json(res, 200, { ok: true });
      }
      if (path === '/__sim/reset') {
        orders.clear(); payments.clear(); refunds.clear(); calls = []; faults = []; faultsAfter = [];
        return json(res, 200, { ok: true });
      }
      if (path === '/__sim/state') {
        return json(res, 200, { orders: [...orders.values()], payments: [...payments.values()], refunds: [...refunds.values()], calls });
      }
      if (path === '/__sim/set-payment') {
        const p = payments.get(body.payment_id);
        if (!p) return err(res, 404, 'BAD_REQUEST_ERROR', 'unknown payment');
        Object.assign(p, body.patch);
        return json(res, 200, p);
      }
      return err(res, 404, 'NOT_FOUND', 'unknown sim endpoint');
    }

    // ── Razorpay API ──
    const expected = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
    if (req.headers.authorization !== expected) return err(res, 401, 'BAD_REQUEST_ERROR', 'Authentication failed');
    calls.push({ method: req.method, path });

    const fault = faults.find((f) => path.includes(f.match) && (!f.method || f.method === req.method) && f.count > 0);
    if (fault) {
      fault.count -= 1;
      return err(res, fault.status, 'SERVER_ERROR', 'Simulated provider failure');
    }

    // From here on, replies may be turned into a 5xx by a "fault-after" rule (see json()).
    res.apiPath = path;
    res.apiMethod = req.method;

    let m;
    if (req.method === 'POST' && path === '/orders') {
      if (!Number.isInteger(body.amount) || body.amount < 100) return err(res, 400, 'BAD_REQUEST_ERROR', 'Order amount less than minimum amount allowed');
      const order = { id: rid('order'), amount: body.amount, currency: body.currency ?? 'INR', receipt: body.receipt ?? null, status: 'created', notes: body.notes ?? {} };
      orders.set(order.id, order);
      return json(res, 200, order);
    }
    if (req.method === 'GET' && (m = path.match(/^\/orders\/([^/]+)\/payments$/))) {
      if (!orders.has(m[1])) return err(res, 400, 'BAD_REQUEST_ERROR', 'The id provided does not exist');
      return json(res, 200, { items: [...payments.values()].filter((p) => p.order_id === m[1]) });
    }
    if (req.method === 'GET' && (m = path.match(/^\/payments\/([^/]+)$/))) {
      const p = payments.get(m[1]);
      return p ? json(res, 200, p) : err(res, 400, 'BAD_REQUEST_ERROR', 'The id provided does not exist');
    }
    if (req.method === 'POST' && (m = path.match(/^\/payments\/([^/]+)\/capture$/))) {
      const p = payments.get(m[1]);
      if (!p) return err(res, 400, 'BAD_REQUEST_ERROR', 'The id provided does not exist');
      if (p.status !== 'authorized') return err(res, 400, 'BAD_REQUEST_ERROR', 'This payment has already been captured or failed');
      if (body.amount !== p.amount) return err(res, 400, 'BAD_REQUEST_ERROR', 'Capture amount must be equal to the amount authorized');
      p.status = 'captured';
      p.captured = true;
      const order = orders.get(p.order_id);
      if (order) order.status = 'paid';
      return json(res, 200, p);
    }
    if (req.method === 'GET' && (m = path.match(/^\/payments\/([^/]+)\/refunds$/))) {
      if (!payments.has(m[1])) return err(res, 400, 'BAD_REQUEST_ERROR', 'The id provided does not exist');
      return json(res, 200, { items: [...refunds.values()].filter((r) => r.payment_id === m[1]) });
    }
    if (req.method === 'POST' && (m = path.match(/^\/payments\/([^/]+)\/refund$/))) {
      const p = payments.get(m[1]);
      if (!p) return err(res, 400, 'BAD_REQUEST_ERROR', 'The id provided does not exist');
      if (!p.captured) return err(res, 400, 'BAD_REQUEST_ERROR', 'The payment has not been captured, so it cannot be refunded');
      if (!Number.isInteger(body.amount) || body.amount < 1) return err(res, 400, 'BAD_REQUEST_ERROR', 'Invalid refund amount');
      if (body.amount > p.amount - p.amount_refunded) return err(res, 400, 'BAD_REQUEST_ERROR', 'The refund amount provided is greater than amount captured');
      p.amount_refunded += body.amount;
      p.status = p.amount_refunded === p.amount ? 'refunded' : 'captured';
      const refund = { id: rid('rfnd'), payment_id: p.id, amount: body.amount, status: 'processed', notes: body.notes ?? {} };
      refunds.set(refund.id, refund);
      return json(res, 200, refund);
    }
    return err(res, 404, 'NOT_FOUND', `No route ${req.method} ${path}`);
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = server.address().port;

  return {
    port: actual,
    /** What RAZORPAY_API_BASE should be set to. */
    apiBase: `http://127.0.0.1:${actual}/v1`,
    simBase: `http://127.0.0.1:${actual}/__sim`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
