import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile exists in the user's home directory; pin the tracing root to this app.
  outputFileTracingRoot: process.cwd(),
  // The end-to-end harness builds into its own folder so it never clobbers a developer's `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // Product photos are served from a single CDN host (S3/CloudFront). Other hosts fall back to <img>.
    remotePatterns: process.env.NEXT_PUBLIC_IMAGE_HOST
      ? [{ protocol: "https", hostname: process.env.NEXT_PUBLIC_IMAGE_HOST }]
      : [],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
