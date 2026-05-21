# Security Audit — highyield.cards
**Date:** 2026-05-20  
**Auditor:** Claude Code (claude-sonnet-4-6)  
**Branch:** main @ 746d23e  
**Scope:** Full codebase audit across 10 domains

---

## Remediation — 2026-05-21

All 13 findings resolved. Remediated on branch `main`.

| ID | Severity | Status |
|----|----------|--------|
| C1 | 🔴 Critical | ✅ Resolved 2026-05-21 |
| M1 | 🟡 Medium | ✅ Resolved 2026-05-21 |
| M2 | 🟡 Medium | ✅ Resolved 2026-05-21 |
| M3 | 🟡 Medium | ✅ Resolved 2026-05-21 |
| M4 | 🟡 Medium | ✅ Resolved 2026-05-21 |
| M5 | 🟡 Medium | ✅ Resolved 2026-05-21 |
| M6 | 🟡 Medium | ✅ Resolved 2026-05-21 |
| M7 | 🟡 Medium | ✅ Resolved 2026-05-21 |
| M8 | 🟡 Medium | ✅ Resolved 2026-05-21 |
| L1 | 🟢 Low | ✅ Resolved 2026-05-21 * |
| L2 | 🟢 Low | ✅ Resolved 2026-05-21 |
| L3 | 🟢 Low | ✅ Resolved 2026-05-21 |
| L4 | 🟢 Low | ✅ Resolved 2026-05-21 |

\* L1 postcss: top-level `postcss` updated via `npm update postcss`. The nested copy inside `node_modules/next/node_modules/postcss` cannot be updated independently — `npm audit fix --force` would downgrade Next.js to 9.3.3 (breaking). Advisory remains in `npm audit` output but is unexploitable in this app (PostCSS runs only at build time on trusted Tailwind source; no user-controlled CSS is ever processed).

---

## Summary

| Severity | Total | Open |
|----------|-------|------|
| 🔴 Critical | 1 | 0 |
| 🟡 Medium | 8 | 0 |
| 🟢 Low | 4 | 0 |

---

## 🔴 Critical

### C1 — Rate limit bypass via `x-forwarded-for` spoofing
**File:** `app/api/generate/route.ts:211`

```ts
const identifier: string | null = userId ?? req.headers.get("x-forwarded-for");
```

**What's wrong:** Vercel preserves any existing `X-Forwarded-For` header from the request and appends the real connecting IP to it. So if a client sends `X-Forwarded-For: fakevalue`, the header arriving at the function is `fakevalue, real-ip`. The full concatenated string is used as the rate-limit bucket key. Every distinct prefix creates a new, independent 5-generation quota. An anonymous user can enumerate unlimited free generations by rotating spoofed prefixes.

**Exploit:** `curl -H "X-Forwarded-For: uuid-$(uuidgen)" https://highyield.cards/api/generate ...` — each call gets a fresh 5-generation window.

**Fix:** Use `req.headers.get("x-real-ip")` or parse only the **last** (rightmost) IP from the `x-forwarded-for` header, which is the one Vercel itself inserted and cannot be spoofed:

```ts
function getTrustedIp(req: NextRequest): string | null {
  // Vercel appends the real IP as the last entry.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",");
    return parts[parts.length - 1].trim();
  }
  return req.headers.get("x-real-ip");
}

const identifier: string | null = userId ?? getTrustedIp(req);
```

---

## 🟡 Medium

### M1 — LLM citation string injected raw into HTML card content
**File:** `app/api/generate/route.ts:325`

```ts
`<span style="...">${citationStr}</span>`
```

**What's wrong:** `citationStr` is taken directly from Gemini's JSON output and interpolated into an HTML string without escaping. If prompt injection in user-supplied document text causes Gemini to output HTML in the citation field (e.g. `Section 1 <img src=x onerror=...>`), that markup is embedded verbatim in the Anki deck's card HTML. Anki's card renderer does execute HTML including `<script>` and `<img>` event handlers on some platforms.

**Fix:** HTML-escape citation content before injection:

```ts
function escapeHtml(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
          .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
// ...
`<span style="...">${escapeHtml(citationStr)}</span>`
```

Apply the same escaping to any other LLM-sourced string spliced into HTML (none found currently, but good practice going forward).

---

### M2 — `/api/embed-preset` is unauthenticated and unmetered
**File:** `app/api/embed-preset/route.ts:75–158`

**What's wrong:** The endpoint accepts an arbitrary `.apkg` file upload, unzips it with JSZip, parses it as SQLite with sql.js, and re-zips the result. It has **no authentication check**, **no rate limiting**, and **no file size cap** before any of this processing begins. Any unauthenticated caller can hammer it freely, and a carefully crafted zip/SQLite file could cause memory exhaustion or unexpected behavior in the in-process SQLite engine.

Additionally, `JSON.parse(presetJson) as AnkiPreset` performs no schema validation on the preset fields before passing them to `buildDconfEntry`. Malformed numeric fields (e.g. `Infinity`, `NaN`, deeply nested objects) will be silently JSON-serialized into the Anki collection.

**Fixes:**
1. Add an auth check (even a soft one — only logged-in users, or gate behind Pro):
   ```ts
   const { userId } = await auth();
   if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
   ```
2. Add a file size guard before JSZip:
   ```ts
   if (apkgBytes.byteLength > 50_000_000) { // 50 MB
     return NextResponse.json({ error: "File too large" }, { status: 413 });
   }
   ```
3. Validate `preset` fields are finite numbers within expected ranges using Zod or manual checks.

---

### M3 — Checkout endpoint accepts attacker-controlled `identifier`
**File:** `app/api/stripe/checkout/route.ts:24–45`

```ts
const body = await req.json();
bodyIdentifier = body.identifier;          // user-controlled
// ...
const identifier = userId ?? bodyIdentifier ?? "anonymous";
```

**What's wrong:** An anonymous caller can set `identifier` in the POST body to any arbitrary string. If they complete checkout, the Stripe webhook grants `pro:{arbitrary-string}`. An attacker who knows the IP-based identifier of another anonymous user (or who wants to game their own rate-limit key) can direct the Pro grant wherever they choose — including `pro:0.0.0.0` (all-zeros identifier) or strings they plan to use as spoofed X-Forwarded-For values.

This also allows an attacker to deliberately trigger `pro:anonymous`, which would grant Pro status to every anonymous user sharing that fallback bucket.

**Fix:** Never trust `bodyIdentifier` for Pro grants. For unauthenticated users derive the identifier the same way `/api/generate` does (rightmost `x-forwarded-for` IP), so the rate-limit key and the pro-grant key are consistent:

```ts
const identifier = userId ?? getTrustedIp(req) ?? "anonymous";
// remove bodyIdentifier entirely
```

---

### M4 — Rate limiting silently disabled when Upstash is unconfigured
**File:** `app/api/generate/route.ts:212–227`

```ts
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.warn("Upstash env vars not set — skipping rate limit check");
  // continue without rate limiting
}
```

**What's wrong:** If the Upstash environment variables are absent — due to misconfiguration, a new deployment environment, or a preview branch — the endpoint runs completely unmetered. A `console.warn` is the only signal; the application continues serving without any generation quota.

**Fix:** Fail hard instead of silently permitting:

```ts
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
}
```

Or at minimum, in a CI/startup check, assert that these variables are present.

---

### M5 — Internal error messages from third-party services returned to client
**Files:**  
- `app/api/generate/route.ts:300` — `Gemini request failed: ${message}`  
- `app/api/generate/route.ts:308` — `Visual enrichment failed: ${message}`  
- `app/api/generate/route.ts:342` — `Anki export failed: ${message}`  
- `app/api/embed-preset/route.ts:147` — `Preset embed failed: ${message}`

**What's wrong:** `err.message` from internal library exceptions is passed directly to the client. This can expose internal system details: Gemini API quota errors include billing account info, Google SDK errors include API endpoint URLs, sql.js errors include internal schema details. These messages give attackers useful reconnaissance.

**Fix:** Log the full message server-side and return a generic error to the client:

```ts
} catch (err) {
  console.error("[generate] Gemini error:", err);
  return NextResponse.json({ error: "Card generation failed. Please try again." }, { status: 502 });
}
```

The webhook route (`app/api/stripe/webhook/route.ts:24`) is an exception — leaking the signature verification failure reason on a 400 is acceptable since it only fires for Stripe-originated requests.

---

### M6 — No HTTP security headers configured
**File:** `next.config.ts`

**What's wrong:** The Next.js config contains no `headers()` export. Every response from the application is served without:
- `Strict-Transport-Security` — browsers won't enforce HTTPS-only
- `X-Content-Type-Options: nosniff` — MIME-type sniffing attacks possible
- `X-Frame-Options: SAMEORIGIN` — site can be embedded in iframes (clickjacking)
- `Referrer-Policy` — full URL leaked in Referer header to third parties (Tally, Vercel Analytics)
- `Permissions-Policy` — no restriction on camera, microphone, geolocation
- `Content-Security-Policy` — no restriction on script sources (mitigated partially by React but not fully)

**Fix:** Add to `next.config.ts`:

```ts
const securityHeaders = [
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "X-Frame-Options",           value: "SAMEORIGIN" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["sql.js"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
```

A full CSP can be added later — it requires careful enumeration of all script/style sources (Clerk, Vercel Analytics, cdnjs, quickchart.io, mermaid.ink).

---

### M7 — CDN-loaded pdfjs without Subresource Integrity (SRI)
**File:** `app/layout.tsx:72`, `app/lib/pdfExtract.ts:20–23`

```tsx
<Script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" ... />
```

```ts
const WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
```

**What's wrong:** Both the main pdfjs library and its Web Worker are loaded from cdnjs without an `integrity` attribute. If cdnjs is ever compromised (supply-chain attack) or the CDN URL is MiTM'd, a malicious script would execute in the user's browser with full access to the PDF content before it's submitted to the server. The pdfjs library runs in the user's browser and has access to every uploaded document.

**Fix:** Generate SRI hashes for both files and add them:
```bash
curl -s https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```
Then:
```tsx
<Script
  src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
  integrity="sha384-<hash>"
  crossOrigin="anonymous"
  strategy="lazyOnload"
/>
```
Alternatively, vendor pdfjs into the project so it's bundled by Next.js directly.

---

### M8 — No file size cap before client-side PDF parsing
**File:** `app/components/DropZone.tsx:183–225`

**What's wrong:** When a PDF is dropped, the file is passed to `extractTextFromPdf()` immediately with no size check. pdfjs-dist parses the entire file in the browser's main thread. A malicious 200 MB PDF, a zip-bomb PDF, or a deeply malformed file could freeze or crash the browser tab before the 50,000-character limit is ever checked.

**Fix:** Add a size guard before calling pdfExtract:

```ts
const MAX_PDF_BYTES = 30 * 1024 * 1024; // 30 MB
if (file.size > MAX_PDF_BYTES) {
  setErrorMsg("PDF too large (max 30 MB). Try splitting the document.");
  setState("error");
  return;
}
```

---

## 🟢 Low

### L1 — npm audit: `postcss < 8.5.10` (moderate)
**Advisory:** GHSA-qx2v-qp2m-jg93 — XSS via unescaped `</style>` in CSS stringify output.  
**Impact:** Low in this app — PostCSS only processes Tailwind CSS at build time; user-controlled CSS is never processed. Not exploitable at runtime.  
**Fix:** `npm update postcss` — the fix requires `next@>=16.3.0` which needs verification for breaking changes.

### L2 — npm audit: `ws 8.0.0–8.20.0` (moderate)
**Advisory:** GHSA-58qx-3vcg-4xpx — Uninitialized memory disclosure.  
**Impact:** Low — `ws` is a dependency of Next.js dev server, not used in production WebSocket connections by this app.  
**Fix:** `npm audit fix` resolves this without breaking changes.

### L3 — `/api/me` and `/api/whoami` have inconsistent auth contract
**Files:** `middleware.ts:3–8`, `app/api/me/route.ts:6–8`, `app/api/whoami/route.ts:5–8`

Both routes are NOT in the `isPublic` matcher, so middleware runs `auth.protect()` on them — redirecting unauthenticated requests before they reach the handler. Yet both handlers contain logic for the unauthenticated case (`if (!userId) return ...`). That code is dead for authenticated middleware but would matter if middleware ever changes. This is a design inconsistency, not an active vulnerability.

**Fix:** Either add these routes to `isPublic` (they're safe to expose publicly), or remove the unauthenticated branches and let middleware handle the auth gate entirely.

### L4 — One-time payment Pro grants are perpetual with no expiry
**File:** `app/api/stripe/webhook/route.ts:40`

```ts
await redis.set(`pro:${identifier}`, "1");  // no TTL
```

For one-time payments, the Redis key is set with no expiration. This is likely intentional (lifetime access), but means there is no automated revocation mechanism for one-time Pro users (e.g., chargebacks, fraud). Contrast with subscriptions which use a 31-day TTL backed by `customer.subscription.deleted` events.

**Fix:** No code change required if lifetime access is intentional. Consider adding a chargeback handler (`charge.refunded`) to delete the key if fraud protection is a concern.

---

## Audit Checklist Status

| Area | Status | Key Notes |
|------|--------|-----------|
| 1. Secret exposure | ✅ Pass | No hardcoded secrets. `.env*` in `.gitignore`. No secrets in git history. |
| 2. API route input validation | ⚠️ Issues | Density/style whitelisted. Text length checked. `embed-preset` unvalidated. |
| 3. Stripe webhook integrity | ✅ Pass | `constructEvent` called on raw body with `webhookSecret` before any trust. |
| 4. Clerk auth boundary | ⚠️ Issues | Middleware correctly guards private routes. `x-forwarded-for` spoofable (C1). |
| 5. Redis / rate limit bypass | 🔴 Fail | Spoofable identifier allows unlimited free quota (C1). |
| 6. PDF parsing safety | ⚠️ Issues | Client-side only (no server crash risk). No client-side size cap (M8). |
| 7. Dependency vulns | ⚠️ Issues | 3 moderate findings: postcss, ws (×2). No critical/high. |
| 8. Client-side data handling | ✅ Pass | No `localStorage`, `sessionStorage`, `document.cookie`, or `dangerouslySetInnerHTML`. |
| 9. Security headers | 🔴 Fail | No security headers in `next.config.ts` (M6). |
| 10. Git hygiene | ✅ Pass | No `.env` files in git history. No secret patterns found in commits. |
