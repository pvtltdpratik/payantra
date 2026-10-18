import type { Server } from 'node:http';

/**
 * Process lifecycle: "am I draining?" for the readiness probe, and the graceful-shutdown sequence.
 *
 * Why the order matters on AWS (ALB/ECS): a SIGTERM does not stop the load balancer sending traffic. The target
 * only leaves rotation after the readiness probe fails a few times, so we (1) start failing readiness at once,
 * (2) keep serving for a short drain window, (3) stop accepting and let in-flight requests finish, (4) close the
 * database, and (5) exit — with a hard deadline so a stuck connection can never block a deploy.
 */
let draining = false;
export const isShuttingDown = () => draining;
/** Test hook. */
export const resetLifecycle = () => {
  draining = false;
};

export interface ShutdownDeps {
  server: Pick<Server, 'close' | 'closeIdleConnections' | 'closeAllConnections'>;
  /** Stops background work (the expiry sweeper). */
  stopBackground: () => void;
  /** Releases the database pool etc. */
  closeResources: () => Promise<void>;
  exit: (code: number) => void;
  log: (msg: string, extra?: Record<string, unknown>) => void;
  drainMs: number;
  timeoutMs: number;
}

export function createShutdown(deps: ShutdownDeps) {
  let started: Promise<void> | null = null;

  return function shutdown(reason: string, exitCode = 0): Promise<void> {
    if (started) return started; // a second SIGTERM/SIGINT must not start a second sequence
    started = (async () => {
      draining = true;
      deps.log('Shutting down', { reason, drainMs: deps.drainMs, timeoutMs: deps.timeoutMs });

      const deadline = setTimeout(() => {
        deps.log('Shutdown deadline reached, forcing exit');
        deps.server.closeAllConnections();
        deps.exit(1);
      }, deps.timeoutMs);
      deadline.unref();

      try {
        // After a crash the process state is untrusted: skip the courtesy drain and leave as fast as we safely can.
        if (deps.drainMs > 0 && exitCode === 0) await new Promise((r) => setTimeout(r, deps.drainMs));
        deps.stopBackground();
        await new Promise<void>((resolve, reject) => {
          // Keep-alive sockets that are idle hold close() open until their own timeout. Closing them once is not enough:
          // a socket that was busy a moment ago becomes idle when its response finishes, so keep sweeping until closed.
          const sweep = setInterval(() => deps.server.closeIdleConnections(), 100);
          sweep.unref();
          deps.server.close((err) => {
            clearInterval(sweep);
            if (err) reject(err);
            else resolve();
          });
          deps.server.closeIdleConnections();
        });
        await deps.closeResources();
        clearTimeout(deadline);
        deps.log('Shutdown complete');
        deps.exit(exitCode);
      } catch (err) {
        deps.log('Shutdown failed', { error: err instanceof Error ? err.message : String(err) });
        clearTimeout(deadline);
        deps.exit(1);
      }
    })();
    return started;
  };
}
