import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/**
 * Thin client for the parts of Razorpay's REST API Payantra uses.
 * Talking to the documented HTTP API directly (instead of the SDK) keeps the surface tiny,
 * lets tests point it at a local mock via RAZORPAY_API_BASE, and makes timeouts explicit.
 *
 * Secrets: the key secret is only ever used to build the Authorization header, and is never
 * included in an error message or log line.
 */

export interface GatewayOrder {
  id: string;
  amount: number;
  currency: string;
  status: 'created' | 'attempted' | 'paid';
  receipt?: string | null;
}

export interface GatewayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method?: string | null;
  captured?: boolean;
  amount_refunded?: number;
  error_description?: string | null;
}

export interface GatewayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: 'pending' | 'processed' | 'failed';
  notes?: Record<string, string> | unknown[] | null;
}

export class GatewayError extends Error {
  constructor(
    /** HTTP status, or 0 for network failures and timeouts. */
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
  /** Worth retrying later (network trouble or Razorpay 5xx); 4xx means the request itself was wrong. */
  get transient() {
    return this.status === 0 || this.status >= 500;
  }
}

export interface PaymentGateway {
  createOrder(input: { amount: number; receipt: string; notes?: Record<string, string> }): Promise<GatewayOrder>;
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  capturePayment(paymentId: string, amount: number): Promise<GatewayPayment>;
  refundPayment(paymentId: string, input: { amount: number; notes?: Record<string, string> }): Promise<GatewayRefund>;
  /** Refunds the provider already holds for a payment — used to avoid double-refunding after a timeout. */
  listPaymentRefunds(paymentId: string): Promise<GatewayRefund[]>;
}

const TIMEOUT_MS = 15_000;

export class RazorpayRestGateway implements PaymentGateway {
  private readonly auth: string;

  constructor(
    private readonly baseUrl: string,
    keyId: string,
    keySecret: string,
  ) {
    this.auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: this.auth,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      logger.warn({ path, timedOut }, 'Razorpay request failed before a response');
      throw new GatewayError(0, timedOut ? 'TIMEOUT' : 'NETWORK', 'Could not reach the payment provider');
    }

    const json = (await res.json().catch(() => null)) as { error?: { code?: string; description?: string } } | null;
    if (!res.ok) {
      const code = json?.error?.code ?? 'UNKNOWN';
      logger.warn({ path, status: res.status, code }, 'Razorpay returned an error');
      throw new GatewayError(res.status, code, json?.error?.description ?? 'Payment provider error');
    }
    return json as T;
  }

  createOrder({ amount, receipt, notes }: { amount: number; receipt: string; notes?: Record<string, string> }) {
    return this.request<GatewayOrder>('POST', '/orders', { amount, currency: 'INR', receipt, notes, payment_capture: 1 });
  }

  async fetchOrderPayments(orderId: string) {
    const r = await this.request<{ items: GatewayPayment[] }>('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
    return r.items ?? [];
  }

  fetchPayment(paymentId: string) {
    return this.request<GatewayPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`);
  }

  capturePayment(paymentId: string, amount: number) {
    return this.request<GatewayPayment>('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount, currency: 'INR' });
  }

  refundPayment(paymentId: string, { amount, notes }: { amount: number; notes?: Record<string, string> }) {
    return this.request<GatewayRefund>('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount, notes });
  }

  async listPaymentRefunds(paymentId: string) {
    const r = await this.request<{ items: GatewayRefund[] }>('GET', `/payments/${encodeURIComponent(paymentId)}/refunds`);
    return r.items ?? [];
  }
}

let gateway: PaymentGateway | null = null;

export function getGateway(): PaymentGateway {
  gateway ??= new RazorpayRestGateway(env.RAZORPAY_API_BASE, env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET);
  return gateway;
}
