export function startMockSupabase(opts?: { port?: number }): Promise<{
  url: string;
  port: number;
  stop(): Promise<void>;
}>;
