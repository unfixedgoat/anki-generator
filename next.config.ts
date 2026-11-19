import type { NextConfig } from "next";

// Report-Only: violations log to the browser console but nothing is blocked.
// Watch the console across sign-in, checkout, PDF upload, and generation; once
// clean, promote to "Content-Security-Policy" to actually enforce.
// 'unsafe-inline'/'unsafe-eval' are required by the Next.js inline bootstrap
// and clerk-js; tightening those needs a nonce-based setup.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://clerk.highyield.cards https://*.clerk.accounts.dev https://challenges.cloudflare.com",
  "connect-src 'self' https://clerk.highyield.cards https://*.clerk.accounts.dev",
  "img-src 'self' data: blob: https://img.clerk.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self' https://argus-sand-omega.vercel.app",
].join("; ");

// Enforced, unlike the policy above: framing is refused for every origin except this site and Argus (the
// site monitor, whose site page shows the app live). frame-ancestors is ignored in a Report-Only policy,
// so it needs its own enforced header. It replaces X-Frame-Options: SAMEORIGIN, which cannot name an
// allowed origin; CSP frame-ancestors overrides X-Frame-Options in current browsers.
const frameAncestors = "frame-ancestors 'self' https://argus-sand-omega.vercel.app";

const securityHeaders = [
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "Content-Security-Policy",   value: frameAncestors },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["sql.js"],

  // sql.js ships every build variant it has ever supported in one `dist/`:
  // asm.js fallbacks, browser builds, web-worker builds and a debug copy of
  // each. `serverExternalPackages` copies the package in verbatim rather than
  // bundling it, so all 19 MB landed in BOTH functions that require it — 38 MB
  // of the deployment's function storage to run two files.
  //
  // Node resolves the package to dist/sql-wasm.js (its `main`), which loads
  // dist/sql-wasm.wasm from the same directory. Nothing else here is reachable
  // on the server. Excluding the rest leaves ~0.7 MB per function.
  //
  // Keep these globs in step with sql.js upgrades: a new entrypoint that does
  // not match `sql-wasm.*` would be dropped and fail at runtime, not at build.
  outputFileTracingExcludes: {
    "*": [
      "node_modules/sql.js/dist/sql-asm*",
      "node_modules/sql.js/dist/worker.*",
      "node_modules/sql.js/dist/*-debug.*",
      "node_modules/sql.js/dist/*browser*",
    ],
  },
  // Already the Next.js default, but pinned explicitly so a future default
  // change can never ship client-readable source maps.
  productionBrowserSourceMaps: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
