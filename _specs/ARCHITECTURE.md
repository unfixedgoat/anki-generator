# Architecture

This is a Next.js 16 app-router application (React 19, TypeScript, Tailwind CSS v4) deployed as a serverless function. The left column renders `DropZone` (PDF upload or text paste → calls `/api/generate` → downloads `.apkg`); the right column renders `SettingsRecommender` (pure client-side calculation of Anki deck settings, optionally calling `/api/embed-preset` to bake those settings into the `.apkg`). Shared state is a single `GenerationInfo` object owned by `page.tsx` and passed down as props. Design tokens are an amber palette (`#c97f1a` active amber, `#7a4f0d` dark amber text, `#f0c87a`/`#fef8ee`/`#fffdf7` amber tints) over slate neutrals; all tokens are Tailwind arbitrary-value classes, not CSS variables.

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/generate` | POST | Receives text + style/density → calls Gemini → enriches visuals → returns `.apkg` |
| `/api/embed-preset` | POST | Receives `.apkg` + preset JSON → patches SQLite → returns new `.apkg` |
| `/api/stripe/checkout` | POST | Accepts `{ plan, identifier }`, creates Stripe Checkout Session, returns `{ url }` |
| `/api/stripe/webhook` | POST | Verifies Stripe signature, writes/deletes `pro:{identifier}` in Redis on `checkout.session.completed` and `customer.subscription.deleted` |
| `/api/whoami` | GET | Returns `{ identifier }` from Vercel's `x-forwarded-for` header |

## Runtime-critical dependencies

| Package | Version | Used for |
|---|---|---|
| `@google/genai` | — | Gemini 2.5 Flash card generation |
| `jszip` | — | Reading and writing `.apkg` zip archives |
| `sql.js` | — | Opening `collection.anki2` SQLite inside serverless functions |
| `lucide-react` | — | Icon set (CheckCircle2, AlertCircle, Loader2, Upload, X) |
| `next` | — | Framework, app router, serverless API routes |
| `react` / `react-dom` | — | UI runtime |
| `@vercel/analytics` | 2.0.1 | Page view tracking + custom events |
| `@upstash/ratelimit` | — | Sliding window rate limiter |
| `@upstash/redis` | — | Redis client for Upstash |
| `stripe` | ^22 | Server-side Stripe SDK |
| `@stripe/stripe-js` | ^9 | Client-side Stripe SDK |

## Environment variables

| Variable | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |
| `STRIPE_SECRET_KEY` | Stripe server-side key (`sk_test_` / `sk_live_`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe client-side publishable key |

## app/lib modules

| File | Exports |
|---|---|
| `ratelimit.ts` | `ratelimit` (slidingWindow 5/30d); `isPro(identifier: string): Promise<boolean>` |

## Components

| Component | Props / notes |
|---|---|
| `UpgradeModal.tsx` | `isOpen`, `onClose`, `reason: "limit" \| "characters"`. Shown when `/api/generate` returns 429 (rate limit) or 400 `characters` error. Two CTAs: Pro $6/mo and one-time $2. Wired to `/api/stripe/checkout`. |

## Rate limiting

- **Free tier:** 5 decks per 30 days, keyed by `x-forwarded-for` IP via Upstash `slidingWindow`
- **Pro bypass:** `isPro(identifier)` checked before rate limit — pro users skip entirely
- **Character cap:** 50,000 chars hard limit, checked after text extraction, before Gemini call; returns `400 { error: "characters" }`
- **Pro character cap:** 300,000 chars (enforced at modal/checkout level, not yet in route)

## Production gotchas

- Non-www `highyield.cards` redirects with 307 and drops FormData body. Always use `www.highyield.cards` as canonical in scripts and API calls.
- Vercel unconditionally overwrites `X-Forwarded-For` with the real origin IP. Custom identifier headers do not work. Use `/api/whoami` + Redis for production test isolation.
