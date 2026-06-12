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
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "X-Frame-Options",           value: "SAMEORIGIN" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["sql.js"],
  // Already the Next.js default, but pinned explicitly so a future default
  // change can never ship client-readable source maps.
  productionBrowserSourceMaps: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
