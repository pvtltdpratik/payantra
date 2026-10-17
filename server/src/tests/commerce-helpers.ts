import { createHmac, randomUUID } from 'node:crypto';

/** Control endpoints of the mock Razorpay started in globalSetup. */
const simBase = () => process.env.RAZORPAY_SIM_BASE as string;

export async function sim<T = any>(path: string, body: object = {}): Promise<T> {
  const res = await fetch(`${simBase()}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}

export async function simState(): Promise<{ orders: any[]; payments: any[]; refunds: any[]; calls: { method: string; path: string }[] }> {
  return (await (await fetch(`${simBase()}/state`)).json()) as never;
}

/** The customer "pays" in Razorpay Checkout. Returns what the browser's handler would receive. */
export async function customerPays(razorpayOrderId: string, outcome: 'captured' | 'authorized' | 'failed' = 'captured', extra: object = {}) {
  return sim<{
    payment: { id: string; amount: number; status: string; order_id: string };
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }>('pay', { order_id: razorpayOrderId, outcome, ...extra });
}

export const WEBHOOK_SECRET = 'dummy_webhook_secret';

/** Builds a webhook exactly as Razorpay would: raw JSON text + HMAC-SHA256 of those bytes. */
export function signedWebhook(event: object, opts: { eventId?: string; secret?: string } = {}) {
  const raw = JSON.stringify(event);
  return {
    raw,
    signature: createHmac('sha256', opts.secret ?? WEBHOOK_SECRET).update(raw).digest('hex'),
    eventId: opts.eventId ?? `evt_${randomUUID()}`,
  };
}

export const paymentEvent = (name: string, payment: object) => ({ entity: 'event', event: name, payload: { payment: { entity: payment } } });
export const refundEvent = (name: string, refund: object) => ({ entity: 'event', event: name, payload: { refund: { entity: refund } } });
