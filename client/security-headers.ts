/**
 * HTTP security headers for the storefront (imported by next.config.ts).
 *
 * Two layers:
 *  - ALWAYS: headers that cannot break a page (nosniff, framing, referrer, permissions, COOP).
 *  - A Content-Security-Policy, only for a real HTTPS deployment in production. It is built from the same
 *    NEXT_PUBLIC_* variables the app itself uses, so the allow-list can never drift from the URLs the code calls.
 *
 * Why 'unsafe-inline' for scripts: a nonce-based policy forces every page to render dynamically per request, which
 * defeats Cache Components / partial prerendering (see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 * The policy still does the heavy lifting: no foreign script hosts, no <object>, no <base> hijacking, no framing,
 * and form posts and network calls only to the origins listed here.
 *
 * Read at BUILD time (Next evaluates `headers()` during `next build`), so set these when building:
 *   CSP_MODE        enforce (default) | report-only | off     — report-only logs violations without blocking
 *   CSP_REPORT_URI  optional https URL that receives violation reports
 */

export interface Header {
  key: string;
  value: string;
}

const RAZORPAY = "https://*.razorpay.com";

const originOf = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

export function contentSecurityPolicy(env: NodeJS.ProcessEnv, reportUri?: string): string {
  const api = originOf(env.NEXT_PUBLIC_API_URL);
  const supabase = originOf(env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseWs = supabase?.replace(/^http/, "ws") ?? null;
  const imageHost = env.NEXT_PUBLIC_IMAGE_HOST ? `https://${env.NEXT_PUBLIC_IMAGE_HOST}` : null;

  const list = (...items: (string | null | false | undefined)[]) => items.filter(Boolean).join(" ");
  const directives: [string, string][] = [
    ["default-src", "'self'"],
    // Razorpay Checkout is loaded as a script from checkout.razorpay.com and opens its own iframe.
    ["script-src", list("'self'", "'unsafe-inline'", RAZORPAY)],
    ["style-src", "'self' 'unsafe-inline'"],
    // Product photos come from the CDN; profile pictures come from the sign-in provider (any https host).
    ["img-src", list("'self'", "data:", "blob:", imageHost, RAZORPAY, "https:")],
    ["font-src", "'self' data:"],
    ["connect-src", list("'self'", api, supabase, supabaseWs, RAZORPAY)],
    ["frame-src", RAZORPAY],
    ["media-src", "'self' blob: data:"],
    ["worker-src", "'self' blob:"],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ["upgrade-insecure-requests", ""],
  ];
  if (reportUri) directives.push(["report-uri", reportUri]);
  return directives.map(([k, v]) => (v ? `${k} ${v}` : k)).join("; ");
}

export function securityHeaders(env: NodeJS.ProcessEnv = process.env): Header[] {
  const production = env.NODE_ENV === "production";
  const https = (env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");

  const headers: Header[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Nothing on this site needs the camera, microphone or location. (`payment` is left alone: Razorpay's iframe uses it.)
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=()" },
    // Keeps popups (Razorpay's bank pages) working while isolating the window from cross-origin openers.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "X-DNS-Prefetch-Control", value: "on" },
  ];

  if (production && https) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });

    const mode = (env.CSP_MODE ?? "enforce").toLowerCase();
    if (mode !== "off") {
      const reportUri = env.CSP_REPORT_URI?.startsWith("https://") ? env.CSP_REPORT_URI : undefined;
      headers.push({
        key: mode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
        value: contentSecurityPolicy(env, reportUri),
      });
    }
  }
  return headers;
}
