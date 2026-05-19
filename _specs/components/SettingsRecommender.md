# SettingsRecommender component

`app/components/SettingsRecommender.tsx`

## Props

```ts
interface Props {
  genInfo?: GenerationInfo | null;   // deck blob + metadata from DropZone
  onNewGenInfo?: (info: GenerationInfo) => void;  // called after regeneration
}
```

## State variables

| Name | Type | Initial value | Purpose |
|---|---|---|---|
| `daysUntilExam` | `string` | `""` | Numeric input, blank = no exam |
| `goal` | `GoalProfile` | `"balanced"` | One of: cram, exam_then_retain, balanced, long_term |
| `budget` | `string` | `""` | Minutes/day budget, blank = unconstrained |
| `difficulty` | `DifficultyAssessment` | `"medium"` | One of: easy, medium, hard |
| `preset` | `AnkiPreset \| null` | `null` | Output of `computePreset`; null = not yet calculated |
| `isRegenerating` | `boolean` | `false` | True while `/api/generate` re-call is in flight |
| `inputsCollapsed` | `boolean` | `false` | Hides full input form, shows compact pills |
| `manualCardCount` | `string` | from `genInfo?.cardCount` or `""` | Editable card count input |
| `liveCardCount` | `number \| null` | `null` | Card count after a regeneration |
| `liveBlob` | `Blob \| null` | `null` | Most-recent `.apkg` blob (overrides genInfo.blob) |
| `liveGenInfo` | `GenerationInfo \| null` | `null` | Most-recent GenerationInfo (overrides genInfo prop) |

## Refs

| Name | Type | Purpose |
|---|---|---|
| `presetOutputRef` | `HTMLDivElement` | Programmatic focus target when preset first appears |

## Collapse animation

There is **no height-based CSS animation**. The inputs section uses **conditional rendering** (`{!inputsCollapsed && (...)}`) with Tailwind's `animate-fade-in` class applied to the shown element. When collapsed, a separate compact pills block is rendered (`{inputsCollapsed && (...)}`), also with `animate-fade-in`. The `inputsCollapsed` boolean state directly controls which block is in the DOM — no `useRef` for height measurement, no `max-height` transition, no JS animation library.

## Key sections

| Lines (approx) | Description |
|---|---|
| 1–13 | Imports — `computePreset`, `densityToIntensity`, type imports from `settingsRecommender.ts` |
| 15–32 | `GOAL_OPTIONS`, `DIFFICULTY_OPTIONS`, `DENSITY_LABELS` module-level constants |
| 36–73 | `Field` sub-component — label/value row with expandable `?` rationale button |
| 75–82 | `Section` sub-component — titled card wrapper |
| 86–130 | `WarningCard` sub-component — severity-colored warning with optional "Regenerate at X intensity" button |
| 134–285 | `PresetDisplay` sub-component — summary bar, warnings, rationale hint, 2×2 section grid, download button |
| 289–292 | `Props` interface |
| 294–311 | Main component state declarations |
| 312–321 | `useEffect` hooks: (1) sync `manualCardCount` from live/prop card count; (2) focus `presetOutputRef` when preset appears |
| 322–329 | Derived values: `cardCount`, `apkgBlob`, `activeInfo`, `goalIndex` |
| 331–333 | `parsePosInt` helper |
| 335–351 | `calculate()` — calls `computePreset`, sets `inputsCollapsed(true)` |
| 353–411 | `handleRegenerate(newDensity)` — re-calls `/api/generate`, triggers download, updates live state, recalculates preset |
| 413 | `canCalculate` — true when `cardCount !== null && cardCount > 0` |
| 415–592 | Return/render: header → input form (or compact pills) → Calculate button → preset output |

## Four preset Section names and fields

| Section | Fields displayed |
|---|---|
| **Daily Limits** | new_cards_per_day, maximum_reviews_per_day, new_cards_ignore_review_limit, limits_start_from_top |
| **New Cards** | learning_steps, graduating_interval (suffixed "d"), easy_interval (suffixed "d"), insertion_order |
| **Lapses** | relearning_steps, minimum_interval (suffixed "d"), leech_threshold, leech_action |
| **FSRS** | FSRS enabled (hardcoded `true`, no rationale), desired_retention (shown as %), maximum_interval |

All fields except boolean-only ones have a `?` rationale button that expands inline.

## Sub-component: PresetDisplay (lines ~134–285)

Has its own local state: `isEmbedding: boolean`, `embedError: string | null`. Handles the "Download with Settings Embedded" button which calls `POST /api/embed-preset` and triggers a download of `{baseName}_with_settings.apkg`. The summary bar (lines ~192–204) shows estimated_daily_minutes, estimated_daily_reviews, and estimated_finish_date in a 3-column grid.
