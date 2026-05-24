# Copy Audit — Surface-by-Surface Findings

Verdicts: **OK** = acceptable as-is | **WATCH** = marginal, revisit if tone-polishing | **FIX** = change needed

---

## Surface 1 — `app/page.tsx`

| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Logo text | `highyield.cards` | OK | — |
| Logo text | `highyield` + `.cards` (colored) | OK | — |
| Tagline (center header) | `Drop your syllabus. Get an Anki deck built around your exam date.` | OK | — |
| AccountChip — signed out | `Sign in` | OK | — |
| AccountChip — signed in + pro | `PRO` (badge) | OK | — |
| Mobile feedback link | `Leave feedback` | OK | — |
| Floating feedback button | `Feedback` | OK | — |

---

## Surface 2 — `app/components/DropZone.tsx`

### Mode toggle
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Input mode — tab 1 | `Upload` | OK | — |
| Input mode — tab 2 | `Paste` | OK | — |

### PDF drop zone (idle/hovering states)
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Drop cue | `Drop a PDF here` | OK | — |
| Hover cue | `Release to upload` | OK | — |
| Browse link | `browse files` | OK | — |
| Aria-label | `Upload PDF` | OK | — |

### Progress steps
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Step 1 | `Extracting text` | OK | — |
| Step 2 | `Generating cards` | OK | — |
| Step 3 | `Packaging deck` | OK | — |
| Cancel button | `Cancel` | OK | — |

### Success panel
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Heading | `Deck downloaded` | OK | — |
| Subtext | *(filename shown)* | OK | — |
| Flag link | `Report a bad deck` | **FIX** | `Report a problem with this deck` |
| Reset | `Start over` | OK | — |

### Error panel
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Heading | `Something went wrong` | WATCH | Generic but paired with specific message below; acceptable |
| Reset | `Try again` | OK | — |

### Programmatic error messages
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Non-PDF file | `Only PDF files are accepted.` | OK | — |
| File too large | `PDF too large (max 30 MB). Try splitting the document.` | OK | — |
| Extract failure | `` `Could not extract text: ${msg}` `` | **FIX** | `Could not read this PDF. ${msg}` — or swallow the raw message entirely: `Could not read this PDF. Try a different file or paste the text instead.` |
| Scanned PDF | `This PDF contains no extractable text (it may be scanned). Try pasting the text instead.` | OK | — |
| Fallback catch | `Something went wrong.` | WATCH | Redundant with the panel heading when both appear; acceptable |

### Custom prompt textarea (style = "custom")
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Placeholder | `Describe exactly how you want Gemini to format your cards…` | **FIX** | `Describe exactly how you want your cards formatted…` — "Gemini" is an implementation detail; leaking the model name is surprising and may age badly |

### Text paste area
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Placeholder | `Paste your notes, lecture text, or study material here…` | OK | — |
| Keyboard hint | `⌘↵ to generate` | OK | — |
| Generate button | `Generate` | OK | — |

---

## Surface 3 — `app/components/DensityToggle.tsx`

| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Pill 1 label | `High-Yield` | OK | — |
| Pill 1 subtitle | `Core concepts & pathways only.` | WATCH | "pathways" reads as med-school jargon; consider `Core concepts only.` for broader audiences |
| Pill 2 label | `Comprehensive` | OK | — |
| Pill 2 subtitle | `Includes secondary details & clinical correlations.` | WATCH | "clinical correlations" is med-specific; if broadening scope: `Includes secondary details and supporting context.` |
| Pill 3 label | `Granular` | OK | — |
| Pill 3 subtitle | `PhD-level extraction of all testable facts.` | WATCH | "PhD-level" is imprecise and won't resonate for undergrads or hobbyists; consider `Every testable fact, edge case, and detail.` |
| Aria-label | `Card density` | OK | — |

---

## Surface 4 — `app/components/StyleToggle.tsx`

| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Tile 1 label | `Standard` | OK | — |
| Tile 1 subtitle | `Q&A sentence` | OK | — |
| Tile 2 label | `Cloze` | OK | — |
| Tile 2 subtitle | `Fill in blank` | **FIX** | `Fill in the blank` — missing article; all other subtitles are noun phrases, this one is an imperative fragment |
| Tile 3 label | `Concise` | OK | — |
| Tile 3 subtitle | `Short answer` | OK | — |
| Tile 4 label | `Essay` | OK | — |
| Tile 4 subtitle | `Long form` | OK | — |
| Tile 5 label | `MCQ` | OK | — |
| Tile 5 subtitle | `4 choices` | OK | — |
| Tile 6 label | `Solve` | OK | — |
| Tile 6 subtitle | `Step by step` | OK | — |
| Tile 7 label | `Formula` | OK | — |
| Tile 7 subtitle | `Math & chem` | WATCH | Undersells scope — Formula covers physics, biology, economics too; consider `Equations` or `Math & science` |
| Tile 8 label | `Custom` | OK | — |
| Tile 8 subtitle | `Your prompt` | OK | — |
| Aria-label | `Card style` | OK | — |

---

## Surface 5 — `app/components/SettingsRecommender.tsx`

### Header area
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Section heading | `Settings Recommender` | WATCH | "Recommender" is ML-jargon; `Anki Settings Advisor` or `Deck Settings` is friendlier, though "Recommender" is fine for a power-user audience |
| Subtitle | `Starting defaults for new decks — for personalized tuning, use FSRS Optimize after ~1,000 reviews` | **FIX** | Two distinct thoughts crammed into one line with an em-dash. Split: `Starting defaults for new decks.` on line 1, `For personalized tuning, run FSRS Optimize after ~1,000 reviews.` on line 2 — or drop to a single sentence and cut the FSRS nudge (it appears again in the output). |

### FSRS toggle
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Label | `Using FSRS?` | OK | — |
| Option 1 | `Yes — FSRS` | OK | — |
| Option 2 | `No — SM-2` | OK | — |
| FSRS description | `Modern algorithm — enabled by default in new Anki profiles` | OK | — |
| SM-2 description | `Legacy SM-2 algorithm — all classic settings apply` | WATCH | "all classic settings apply" is vague; consider `Legacy algorithm — uses ease, intervals, and learning steps` |

### Inputs
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Label | `Card count` | OK | — |
| Placeholder | `number of cards in your deck` | OK | — |
| Label | `Days until exam` | OK | — |
| Placeholder | `leave blank if no exam` | OK | — |
| Label | `Goal` | OK | — |
| Label | `Material difficulty` | OK | — |
| Label | `Min / day budget` | **FIX** | Ambiguous — "min" could mean "minimum" or "minutes". Use `Daily time budget (min)` or `Minutes per day` |
| Placeholder | `optional` | OK | — |

### Goal pill subtitles
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Cram | `Optimize for exam date, retention not prioritized` | **FIX** | Awkward passive construction. Better: `Pass the exam — long-term retention not required` |
| Ace & Keep | `Ace exam, want it to stick` | **FIX** | Two imperative fragments stitched together. Better: `Ace the exam and retain it long-term` |
| Balanced | `Long-term with exam milestone` | WATCH | "milestone" reads slightly corporate; OK for now |
| Long-term | `No exam, permanent memory` | OK | — |

### Calculate button
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Default | `Calculate Preset` | WATCH | "Preset" is Anki-specific jargon; `Calculate Settings` is more universal |
| With count | `Calculate Preset for ${n} Cards` | WATCH | Same as above |
| Collapsed | `Recalculate` | OK | — |
| Edit button (collapsed pills) | `Edit` | OK | — |

### Output — summary bar
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Stat label 1 | `new cards / day` | OK | — |
| Stat label 2 | `new cards done` | **FIX** | The displayed value is a *date* (e.g. "Jun 15"), not a count. Label reads as "how many done" when it means "done by when". Fix: `finish date` or `new cards done by` |

### Output — field labels (preset sections)
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Section title | `Daily Limits` | OK | — |
| Section title | `New Cards` | OK | — |
| Section title | `Lapses` | OK | — |
| Section title | `FSRS` | OK | — |
| Field | `New cards / day` | OK | — |
| Field | `Max reviews / day` | OK | — |
| Field | `Ignore review limit` | OK | — |
| Field | `Limits from top` | WATCH | Obscure without context — mirrors Anki's internal label, so changing it would confuse cross-referencing users; leave for now |
| Field | `Learning steps` | OK | — |
| Field | `Graduating interval` | OK | — |
| Field | `Easy interval` | OK | — |
| Field | `Insertion order` | OK | — |
| Field | `Relearning steps` | OK | — |
| Field | `Min interval` | OK | — |
| Field | `Leech threshold` | OK | — |
| Field | `Leech action` | OK | — |
| Field | `FSRS enabled` | OK | — |
| Field | `Desired retention` | OK | — |
| Field | `Max interval` | OK | — |
| Rationale toggle aria-label | `Show reasoning` / `Hide reasoning` | OK | — |
| Rationale hint | `Tap ? next to any field for the reasoning.` | WATCH | "reasoning" is fine; on desktop users click not tap — low priority |

### Disclaimer banner (FSRS on)
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Banner heading | `Starting defaults for new decks.` | OK | — |
| Banner body | `Once you have ~1,000 reviews, run FSRS Optimize and Compute Minimum Recommended Retention in Deck Options — those use your personal data and override this tool's retention suggestion.` | OK | Verbatim Anki UI strings quoted correctly; accurate and useful |

### FSRS workload nudge
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Nudge | `Review load grows over time. For an accurate forecast, use Deck Options → FSRS → Workload after ~1,000 reviews.` | OK | — |

### Regenerate button (warning card)
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Button | `Regenerate at ${density} intensity (~${n} cards)` | OK | — |

### Download area
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Download button (idle) | `Download with Settings Embedded` | WATCH | Descriptive but long; acceptable — or shorten to `Download + Settings` |
| Download button (busy) | `Embedding…` | OK | — |
| Embed error (fallback) | `Embed failed` | **FIX** | Too terse, no user action suggested. Better: `Download failed. Please try again.` |
| Instruction line 1 | `Imports into Anki with these settings already applied.` | OK | — |
| Instruction line 2 | `When importing, select Import with deck presets in the Anki import dialog.` | OK | — |
| FSRS notice | `FSRS must be enabled manually: Anki → Tools → Preferences → Review → FSRS.` | OK | Accurate and necessary |

---

## Surface 6 — `app/components/UpgradeModal.tsx`

### Rate-limit variant (`reason = "limit"`)
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Title | `You've used your 5 free decks this month` | OK | — |
| Subtitle | `Upgrade for unlimited generations, all styles, and all density modes.` | OK | — |

### Character-limit variant (`reason = "characters"`)
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Title | `Your document exceeds the free limit` | WATCH | "free limit" is vague; `Your document is too large for the free plan` is more precise |
| Subtitle | `Free accounts support up to 50,000 characters (~10 dense pages). Upgrade for 300,000 character documents.` | **FIX** | "300,000 character documents" reads like a spec sheet. Better: `Free accounts support up to 50,000 characters (~10 dense pages). Upgrade to process documents up to 300,000 characters.` |

### CTAs
| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| Primary CTA | `Upgrade to Pro — $6/mo` | OK | — |
| Primary CTA (loading) | `Loading…` | OK | — |
| Secondary CTA | `Maybe later` | OK | — |
| Link CTA | `Just need one deck? $2 one-time →` | OK | Informal but intentional; matches the one-time purchase framing |
| Link CTA (loading) | `Loading…` | OK | — |

---

## Surface 7 — `app/layout.tsx`

| Surface | String | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|
| `<title>` | `highyield.cards — AI Anki decks from any PDF` | OK | — |
| Meta description | `Drop your syllabus. Get an Anki deck built around your exam date. Free AI-powered flashcard generator optimized for pre-med and serious learners.` | **FIX** | "pre-med" anchors the product to one audience and will discourage law, language, CS, and other users. Rewrite: `Drop your syllabus. Get an Anki deck built around your exam date. Free AI-powered flashcard generator for students and serious learners.` |
| OG title | `highyield.cards — AI Anki decks from any PDF` | OK | — |
| OG description | `Drop your syllabus. Get an Anki deck built around your exam date.` | OK | — |
| OG alt text | `highyield.cards — AI Anki decks from any PDF` | OK | — |
| Twitter card type | `summary_large_image` | OK | — |
| Twitter title | `highyield.cards — AI Anki decks from any PDF` | OK | — |
| Twitter description | `Drop your syllabus. Get an Anki deck built around your exam date.` | OK | — |

---

## Surface 8 — Error strings returned to client (`app/api/*/route.ts`)

### `app/api/generate/route.ts`
| Surface | String | Status | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|---|
| 503 — Redis not configured | `"Service unavailable"` | Internal infra | OK | — |
| 429 — rate limit | `"Free limit reached"` | Intercepted by `RateLimitError` in client; never shown as text | OK | — |
| 500 — missing API key | `"GEMINI_API_KEY is not set"` | **Leaks internal config detail** | **FIX** | `"Service unavailable"` — never expose env var names to clients |
| 400 — no text | `"No text provided"` | OK | OK | — |
| 400 — characters over limit | `"Text exceeds 50,000 character limit (~10 dense pages). Upgrade to Pro for 300,000 characters."` | Readable | WATCH | "Upgrade to Pro for 300,000 characters" is terse; `Upgrade to Pro to process documents up to 300,000 characters.` is cleaner |
| 400 — form parse fail | `"Failed to read form data"` | OK | OK | — |
| 502 — Gemini error | `"Card generation failed. Please try again."` | OK | OK | — |
| 500 — enrichment error | `"Card generation failed. Please try again."` | OK | OK | — |
| 422 — empty card array | `"No flashcards could be generated from this document"` | OK | OK | — |
| 500 — export error | `"Export failed. Please try again."` | OK | OK | — |

### `app/api/embed-preset/route.ts`
| Surface | String | Status | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|---|
| 413 — body too large | `"Request too large or missing Content-Length"` | Rarely user-facing | WATCH | Acceptable; could soften to `"File too large"` if surfaced directly |
| 503 — Redis not configured | `"Service unavailable"` | Internal infra | OK | — |
| 429 — rate limit | `"Rate limit exceeded"` | Inconsistent with generate's `"Free limit reached"` | **FIX** | Standardize: use `"Free limit reached"` or `"Rate limit exceeded"` consistently across both routes |
| 400 — missing fields | `"Missing apkg or preset"` | Internal API call; not user-facing | OK | — |
| 400 — invalid preset | `"Invalid preset fields"` | Internal | OK | — |
| 400 — body parse fail | `"Invalid request body"` | Internal | OK | — |
| 400 — not a zip | `"Uploaded file is not a valid zip archive"` | Could surface via `embedError` | WATCH | OK as-is; could be `"Invalid file. Try regenerating the deck."` |
| 400 — no anki2 file | `"No collection.anki2 found in uploaded file"` | Internal | OK | — |
| 400 — bad SQLite magic | `"Invalid or corrupted Anki database"` | Surfaces as `embedError` | **FIX** | `"Invalid Anki file. Try regenerating the deck."` — hides internal format details |
| 500 — processing error | `"Export failed. Please try again."` | OK | OK | — |

### `app/api/stripe/checkout/route.ts`
| Surface | String | Status | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|---|
| 500 — Stripe not configured | `"Stripe not configured"` | Internal infra | OK | — |
| 400 — bad plan | `"Invalid plan"` | Internal | OK | — |
| 400 — body parse fail | `"Invalid request body"` | Internal | OK | — |
| 400 — price not found | `` `No price found for lookup key "${lookupKey}"` `` | **Leaks internal Stripe lookup key** | **FIX** | `"Payment configuration error"` — lookup key is an internal Stripe detail |

### `app/api/stripe/webhook/route.ts`
| Surface | String | Status | Verdict | Suggested rewrite (if FIX) |
|---|---|---|---|---|
| 500 — Stripe not configured | `"Stripe not configured"` | Webhook response; Stripe-facing only | OK | — |
| 400 — bad signature | `` `Webhook signature verification failed: ${msg}` `` | Stripe-facing only; not user-facing | OK | — |

---

## Surface 9 — Tally form question copy

Tally forms are external and not readable from the codebase. Two forms are referenced:

| Form URL | Purpose | Verdict |
|---|---|---|
| `https://tally.so/r/b5YPre` | General feedback (floating button + mobile link) | Not auditable from code — must review in Tally dashboard |
| `https://tally.so/r/NpbkBW?card=...` | Bad deck report (with card front pre-filled via query param) | Not auditable from code — must review in Tally dashboard |

---

## FIX Summary (priority order)

| # | Surface | String | Action |
|---|---|---|---|
| 1 | `generate/route.ts` | `"GEMINI_API_KEY is not set"` | Replace with `"Service unavailable"` — env var name must not leak |
| 2 | `stripe/checkout/route.ts` | `"No price found for lookup key \"${lookupKey}\""` | Replace with `"Payment configuration error"` |
| 3 | `DropZone.tsx` — custom placeholder | `Describe exactly how you want Gemini to format your cards…` | Remove "Gemini" |
| 4 | `SettingsRecommender.tsx` — summary bar | `new cards done` (label for a date value) | Change to `finish date` |
| 5 | `SettingsRecommender.tsx` — goal | `Optimize for exam date, retention not prioritized` | `Pass the exam — long-term retention not required` |
| 6 | `SettingsRecommender.tsx` — goal | `Ace exam, want it to stick` | `Ace the exam and retain it long-term` |
| 7 | `SettingsRecommender.tsx` — budget label | `Min / day budget` | `Minutes per day` or `Daily time budget (min)` |
| 8 | `SettingsRecommender.tsx` — subtitle | Two-thought em-dash sentence | Split into two sentences |
| 9 | `SettingsRecommender.tsx` — embed error | `Embed failed` | `Download failed. Please try again.` |
| 10 | `StyleToggle.tsx` | `Fill in blank` | `Fill in the blank` |
| 11 | `UpgradeModal.tsx` — characters subtitle | `Upgrade for 300,000 character documents.` | `Upgrade to process documents up to 300,000 characters.` |
| 12 | `DropZone.tsx` — success | `Report a bad deck` | `Report a problem with this deck` |
| 13 | `layout.tsx` — meta description | `optimized for pre-med and serious learners` | `for students and serious learners` |
| 14 | `embed-preset/route.ts` | `"Rate limit exceeded"` vs `"Free limit reached"` in generate | Pick one and use consistently |
| 15 | `embed-preset/route.ts` | `"Invalid or corrupted Anki database"` (surfaced as embedError) | `"Invalid Anki file. Try regenerating the deck."` |
