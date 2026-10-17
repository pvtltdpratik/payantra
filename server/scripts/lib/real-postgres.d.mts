export function startRealPostgres(opts?: { log?: (message: string) => void }): Promise<{
  port: number;
  url: string;
  stop(): Promise<void>;
}>;
