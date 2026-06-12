---
name: feedback_xfwd_parsing
description: X-Forwarded-For parsing — clientIp() now splits by environment; dev uses leftmost (Next dev server appends ::1 hop), production uses rightmost (spoof-resistant)
metadata:
  type: feedback
---

`app/lib/clientIp.ts` parses X-Forwarded-For **leftmost in dev, rightmost in production** (resolved 2026-06-11; supersedes the earlier "always use [0]" guidance).

**Why:** Two competing constraints. (1) The Next.js dev server appends its own hop (`::1`) to X-Forwarded-For, so rightmost parsing in dev collapses every local test identity into one bucket — `scripts/verify-caps.ts` could never exercise the `pro:`/`credit:` tiers it seeds (found 2026-05-24). (2) Leftmost is client-spoofable, so production must parse rightmost (and prefers `x-vercel-forwarded-for`, which Vercel controls). The `NODE_ENV` split in `clientIp()` satisfies both.

**How to apply:** Never flip `clientIp()` back to a single parsing direction. Any new route keying rate limits or entitlements on IP must go through `clientIp()`, not parse headers itself.
