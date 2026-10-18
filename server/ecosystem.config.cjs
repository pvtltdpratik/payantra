/**
 * pm2 process file for running the API on a plain server (for example an EC2 instance).
 *
 *   npm ci --include=dev && npm run build        compile to dist/
 *   pm2 start ecosystem.config.cjs               start (then `pm2 save` and `pm2 startup` to survive reboots)
 *   pm2 reload payantra-api                      after a deploy
 *
 * Why it is written this way:
 *  - `.cjs`: this package is an ES module (`"type": "module"`), and pm2 loads this file with require().
 *  - `node dist/server.js`, not `npm start`: npm would sit between pm2 and Node and swallow SIGINT/SIGTERM, so the
 *    graceful shutdown in src/server.ts (drain, finish in-flight requests, close the database) would never run.
 *  - One instance, fork mode: rate-limit counters live in memory and the order-expiry sweep runs inside the process,
 *    so cluster mode would split the limits and multiply the sweeps.
 *  - `kill_timeout`: pm2 force-kills after 1.6 s by default; the API needs up to SHUTDOWN_DRAIN_SECONDS (5) +
 *    SHUTDOWN_TIMEOUT_SECONDS (25) to stop cleanly. Keep this larger than their sum if you change either.
 *  - `cwd`: the .env file is read from the working directory (dotenv), so it must be this folder.
 */
module.exports = {
  apps: [
    {
      name: 'payantra-api',
      script: 'dist/server.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      kill_timeout: 35000,
      max_memory_restart: '600M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
