# DropZone component

`app/components/DropZone.tsx`

## Props

```ts
interface Props {
  onGenerated?: (info: GenerationInfo) => void;
}
```

`GenerationInfo` (exported): `{ blob, filename, cardCount, density, style, text }`

## State variables

| Name | Type | Purpose |
|---|---|---|
| `inputType` | `"pdf" \| "text"` | Which input mode tab is active |
| `state` | `DropState` | Overall UI state machine |
| `fileName` | `string \| null` | Current file/label shown in panels |
| `errorMsg` | `string \| null` | Error message text |
| `density` | `Density` | Selected density, forwarded to API |
| `cardStyle` | `CardStyle` | Selected style, forwarded to API |
| `customPrompt` | `string` | Free-text prompt when style === "custom" |
| `rawText` | `string` | Controlled value of the paste textarea |
| `loadingStep` | `1 \| 2 \| 3 \| null` | Active step of progress indicator |
| `elapsed` | `number` | Seconds elapsed since generation started |

`DropState` values: `"idle" | "hovering" | "extracting" | "loading" | "success" | "error"`

## Refs

| Name | Type | Purpose |
|---|---|---|
| `inputRef` | `HTMLInputElement` | Programmatic file picker trigger |
| `lastTextRef` | `string` | Holds the source text for external use |
| `abortRef` | `AbortController \| null` | Cancels the in-flight fetch |
| `step2TimerRef` | `ReturnType<typeof setTimeout> \| null` | Fires the step 1→2 transition at t=2s |
| `elapsedIntervalRef` | `ReturnType<typeof setInterval> \| null` | Increments `elapsed` every second |

## Key sections

| Lines (approx) | Description |
|---|---|
| 1–7 | Imports — note `Loader2` removed; `Upload, CheckCircle2, AlertCircle, X` remain |
| 8–9 | `DropState` and `InputType` type aliases |
| 11–22 | `GenerationInfo` and `Props` interfaces |
| 24–49 | `submitToApi` and `triggerDownload` module-level helpers |
| 51–56 | `STEPS` module-level constant (the three step labels and `n: 1\|2\|3`) |
| 58–84 | Component state and ref declarations |
| 86–109 | `clearProgressTimers` and `startProgressSteps` callbacks |
| 111–148 | `handleApiResult` — fires API, drives step 3 delay, triggers download, sets success |
| 150–181 | `processFile` — validates PDF, calls `startProgressSteps`, extracts text, calls `handleApiResult` |
| 183–195 | `processText` — calls `startProgressSteps`, builds FormData, calls `handleApiResult` |
| 197–232 | Drag/drop/input/picker/reset event handlers |
| 234–240 | Derived booleans: `isHovering`, `isExtracting`, `isLoading`, `isSuccess`, `isError`, `isIdle`, `isBusy` |
| **242–278** | **`StepsPanel` JSX variable — the three-step progress indicator (active loading UI)** |
| 280–307 | `SuccessPanel` and `ErrorPanel` JSX variables |
| 309–end | Return / render: mode toggle → DensityToggle → StyleToggle → custom prompt textarea → PDF drop zone → text paste area |

## Loading/Progress UI — StepsPanel (~L242–278)
State: loadingStep (1|2|3|null), elapsed (number, seconds)
Refs: step2TimerRef, elapsedIntervalRef

Flow:
- startProgressSteps() → step 1 immediately, elapsed tick starts, step 2 after 2s
- On API response → clearProgressTimers(), jump to step 3, 1.5s delay → download + success
- clearProgressTimers() called on response, error, and cancel

StepsPanel renders 3 rows:
- Active: pulsing amber circle, text-[#7a4f0d] font-medium
- Done: amber circle + white checkmark
- Pending: empty border circle, text-slate-300
- Elapsed timer below rows
- Cancel button hidden during step 3

Replaces: old ExtractingPanel and LoadingPanel entirely.
Shown whenever isBusy is true.

## Design tokens in use

| Token | Meaning |
|---|---|
| `bg-[#c97f1a]` | Active/filled circle, buttons |
| `text-[#7a4f0d]` | Active step label, amber dark text |
| `border-[#f0c87a]` / `bg-[#fef8ee]` | Success state border/background |
| `bg-[#fffdf7]` | Idle state drop zone background |
| `text-slate-300` | Pending step label |
| `text-slate-400` | Completed step label, elapsed timer |
| `border-slate-200` | Pending step circle, idle/busy border |
| `bg-[#f5f3ee]` | Mode toggle pill background |

## What NOT to touch

- **Drag handlers** (`onDragOver`, `onDragLeave`, `onDrop`) — stateful interaction tied to `DropState`; touching them will break hover detection
- **`abortRef` / cancel flow** — the abort signal is wired through `submitToApi`; do not move or duplicate it
- **Success banner** (`SuccessPanel`, lines ~280–292) — the amber check + "Deck downloaded" + "Start over" button; the spec only changes the in-progress state, not success
- **`openPicker` guard** — `state !== "loading" && state !== "extracting"` prevents re-opening the file picker mid-request
