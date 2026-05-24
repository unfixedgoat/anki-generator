# Triage Queue — Applied Fixes & Deferred Items

**Date:** 2026-05-23

---

## Applied Fixes (15 total)

### Security (2)
| # | File | Old | New |
|---|---|---|---|
| 1 | `app/api/generate/route.ts:274` | `"GEMINI_API_KEY is not set"` | `"Service unavailable"` |
| 2 | `app/api/stripe/checkout/route.ts:56` | `` `No price found for lookup key "${lookupKey}"` `` | `"Payment configuration error"` |

### API consistency / correctness (3)
| # | File | Old | New |
|---|---|---|---|
| 3 | `app/api/embed-preset/route.ts:146` | `"Rate limit exceeded"` | `"Free limit reached"` (matches generate route) |
| 4 | `app/api/embed-preset/route.ts:193` | `"Invalid or corrupted Anki database"` | `"Invalid Anki file. Try regenerating the deck."` |
| 5 | `app/api/embed-preset/route.ts:205` | `"Invalid or corrupted Anki database"` (sql.js catch) | `"Invalid Anki file. Try regenerating the deck."` |

### Copy fixes (10)
| # | File | Old | New |
|---|---|---|---|
| 6 | `app/components/DropZone.tsx:223` | `Could not extract text: ${msg}` | `Could not read this PDF. Try a different file or paste the text instead.` |
| 7 | `app/components/DropZone.tsx:397` | `Report a bad deck` | `Report a problem with this deck` |
| 8 | `app/components/DropZone.tsx:476` | `Describe exactly how you want Gemini to format your cards…` | `Describe exactly how you want your cards formatted…` |
| 9 | `app/components/StyleToggle.tsx:23` | `Fill in blank` | `Fill in the blank` |
| 10 | `app/components/SettingsRecommender.tsx:189` | `"Embed failed"` (fallback) | `"Download failed. Please try again."` |
| 11 | `app/components/SettingsRecommender.tsx:213` | `new cards done` (label for date value) | `finish date` |
| 12 | `app/components/SettingsRecommender.tsx:17` | `Optimize for exam date, retention not prioritized` | `Pass the exam — long-term retention not required` |
| 13 | `app/components/SettingsRecommender.tsx:18` | `Ace exam, want it to stick` | `Ace the exam and retain it long-term` |
| 14 | `app/components/SettingsRecommender.tsx:465` | `Starting defaults for new decks — for personalized tuning, use FSRS Optimize after ~1,000 reviews` | `Starting defaults for new decks. For personalized tuning, run FSRS Optimize after ~1,000 reviews.` |
| 15 | `app/components/SettingsRecommender.tsx:606` | `Min / day budget` | `Minutes per day` |
| 16 | `app/components/UpgradeModal.tsx:19` | `Upgrade for unlimited generations, all styles, and all density modes.` | `Upgrade for unlimited generations and higher document limits.` |
| 17 | `app/components/UpgradeModal.tsx:23` | `Upgrade for 300,000 character documents.` | `Upgrade to process documents up to 300,000 characters.` |
| 18 | `app/layout.tsx:37` | `optimized for pre-med and serious learners` | `for students and serious learners` |

### Code rot — already applied before this session
- `app/lib/visualEnricher.ts` — `FILENAME_REQUIRE` list removed (Option B); REJECT-only is simpler and more robust.
- `app/api/generate/route.ts` — `closeArray` pre-pass added to `extractJson` to recover token-limit-truncated responses.

---

## Adversarial test result (post-fix)

```
17 PASS  0 WARN  0 FAIL  1 INFO
```

The one INFO item (prompt injection) was pre-existing and requires human review. No test regressions from error string changes.

---

## Deferred — WATCH items (pending audience decision)

These items were flagged WATCH in the audit. They are marginal and require a positioning decision before acting.

| Surface | String | Concern | Decision needed |
|---|---|---|---|
| `DensityToggle.tsx` — pill 1 | `Core concepts & pathways only.` | "pathways" = med-school jargon | Keep if audience stays med-heavy; change to `Core concepts only.` if broadening |
| `DensityToggle.tsx` — pill 2 | `Includes secondary details & clinical correlations.` | "clinical correlations" = med-specific | Keep or replace with `Includes secondary details and supporting context.` |
| `DensityToggle.tsx` — pill 3 | `PhD-level extraction of all testable facts.` | "PhD-level" is imprecise | Replace with `Every testable fact, edge case, and detail.` if broadening |
| `StyleToggle.tsx` — Formula | `Math & chem` | Undersells scope | Change to `Math & science` if broadening beyond med/chem |
| `SettingsRecommender.tsx` — Calculate | `Calculate Preset` / `Calculate Preset for ${n} Cards` | "Preset" is Anki jargon | Change to `Calculate Settings` if targeting non-Anki users |
| `SettingsRecommender.tsx` — Download | `Download with Settings Embedded` | Long label | Shorten to `Download + Settings` if space is tight |
| `generate/route.ts:305` | `Upgrade to Pro for 300,000 characters.` (in 400 body) | Terse | Improve to `Upgrade to Pro to process documents up to 300,000 characters.` |
| `embed-preset/route.ts:131` | `Request too large or missing Content-Length` | If surfaced directly | Soften to `"File too large"` |
| `embed-preset/route.ts:177` | `Uploaded file is not a valid zip archive` | Could surface as embedError | Change to `"Invalid file. Try regenerating the deck."` |
| `layout.tsx` — UpgradeModal characters title | `Your document exceeds the free limit` | "free limit" is vague | Change to `Your document is too large for the free plan` |
| `SettingsRecommender.tsx` — FSRS description | `all classic settings apply` | Vague | Replace with `Legacy algorithm — uses ease, intervals, and learning steps` |
| `SettingsRecommender.tsx` — rationale hint | `Tap ? next to any field` | Desktop users click, not tap | Low priority, fix on a dedicated copy-polish pass |
