export function startMockRazorpay(opts: { keyId: string; keySecret: string; port?: number }): Promise<{
  port: number;
  apiBase: string;
  simBase: string;
  stop(): Promise<void>;
}>;
