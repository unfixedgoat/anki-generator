# Copy Sweep — Grep Pass Results

Generated: 2026-05-23
Scope: `app/` and `components/` — `*.tsx`, `*.ts` — 5 query groups

Verdict key:
- **PASS** — claim is true under current code
- **FIX** — claim is false or misleading under current code; needs rewrite
- **N/A** — code comment, internal rationale string, or other non-user-facing context

---

## Query 1 — `optimal|personalized|automatic|best|ideal|perfect`

| File:Line | Match | Verdict |
|---|---|---|
| `app/components/SettingsRecommender.tsx:465` | "Starting defaults for new decks — for personalized tuning, use FSRS Optimize after ~1,000 reviews" | **PASS** — self-described as "starting defaults"; correctly directs users to FSRS Optimize for actual personalization rather than overclaiming |
| `app/lib/pdfExtract.ts:4` | `// It sets window.pdfjsLib automatically — no bundler involvement.` | **N/A** — code comment, not user-facing |
| `app/lib/settingsRecommender.ts:215` | "FSRS can compute a personalized target after ~1,000 reviews — use that instead when available." | **PASS** — accurate; FSRS does personalize parameters post-optimization; surfaced in recommender UI as a rationale note |
| `app/lib/settingsRecommender.ts:362` | "36500 days (100 years) — FSRS schedules to the optimal interval naturally." | **PASS** — rationale text shown in settings recommender; "optimal interval" is FSRS's own algorithm output, not a marketing overclaim |

---

## Query 2 — `wraps FSRS|FSRS.{0,30}retention math|simulator.{0,30}behind`

No matches found.

---

## Query 3 — `all (styles|densities|features)`

| File:Line | Match | Verdict |
|---|---|---|
| `app/components/UpgradeModal.tsx:19` | "Upgrade for unlimited generations, **all styles**, and **all density modes**." | **FIX** — styles (`StyleToggle`) and density (`DensityToggle`) in `DropZone.tsx` are only disabled while `isBusy`; neither is gated by pro status. Free users already have access to all styles and all density modes. The clause falsely implies these are paid features. Remove or replace with accurate differentiators. |

---

## Query 4 — `unlimited`

| File:Line | Match | Verdict |
|---|---|---|
| `app/components/UpgradeModal.tsx:19` | "Upgrade for **unlimited** generations, all styles, and all density modes." | **PASS** (for "unlimited" specifically) — free users hit a `Ratelimit.slidingWindow(5, "30 d")` enforced in `app/api/generate/route.ts`; pro users bypass via `isPro()` check. "Unlimited generations" is an accurate paid-tier differentiator. See Query 3 verdict for the rest of this line. |

---

## Query 5 — `built around your exam|exam date`

| File:Line | Match | Verdict |
|---|---|---|
| `app/layout.tsx:37` | "Get an Anki deck built around your exam date." (HTML `<meta name="description">`) | **PASS** — `SettingsRecommender` collects exam date, derives `days_until_exam`, and uses it to set `desired_retention`, `maximum_interval`, `new_cards_per_day`, and cram mode — core to the deck config |
| `app/layout.tsx:42` | "Get an Anki deck built around your exam date." (`og:description`) | **PASS** — same as above |
| `app/layout.tsx:60` | "Get an Anki deck built around your exam date." (`twitter:description`) | **PASS** — same as above |
| `app/page.tsx:21` | "Drop your syllabus. Get an Anki deck built around your exam date." (hero copy) | **PASS** — exam date is a first-class input in the settings recommender flow |
| `app/components/SettingsRecommender.tsx:17` | "Optimize for exam date, retention not prioritized" (cram mode `sub` label) | **PASS** — accurately describes cram behavior: `maximum_interval` capped at `days_until_exam`, new cards maximized, retention deprioritized |
| `app/lib/settingsRecommender.ts:359` | "Capped at ${days_until_exam} days — no point scheduling cards beyond your exam date." | **N/A** — internal rationale string; shown in settings recommender detail panel, not primary user-facing copy |

---

## Summary

| Verdict | Count |
|---|---|
| PASS | 9 |
| FIX | 1 |
| N/A | 3 |

### Only FIX

**`app/components/UpgradeModal.tsx:19`** — subtitle for the `"limit"` reason variant:

> "Upgrade for unlimited generations, all styles, and all density modes."

`all styles` and `all density modes` are false gates — free users already have full access. The line needs to be rewritten to only advertise real paid differentiators (unlimited generations, higher character limit per document).
