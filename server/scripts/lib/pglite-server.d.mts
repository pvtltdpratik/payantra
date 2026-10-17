export function freePort(): Promise<number>;
export function applyMigrations(db: unknown, log?: (message: string) => void): Promise<void>;
export function startPglite(opts?: {
  dataDir?: string;
  port?: number;
  log?: (message: string) => void;
}): Promise<{
  db: unknown;
  port: number;
  url: string;
  stop(): Promise<void>;
}>;
