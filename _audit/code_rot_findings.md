# Code Rot Audit — Findings

**Date:** 2026-05-23  
**Auditor:** Claude Sonnet 4.6  

---

## Path 1: visualEnricher.ts Wikimedia regex — VERDICT: FIX

### What was checked
The `FILENAME_REQUIRE` and `FILENAME_REJECT` lists in `app/lib/visualEnricher.ts` (lines 51–59). Fetched real Wikipedia `pageimages` API thumbnails for 10 anatomy/biology articles.

### Current lists

```ts
FILENAME_REJECT = [
  "flag", "coat", "arms", "logo", "icon", "portrait", "photo", "map_of",
  "locator", "seal", "emblem", "crest", "person", "people", "building", "landscape",
];
FILENAME_REQUIRE = [
  "diagram", "scheme", "pathway", "structure", "cycle", "receptor", "channel",
  "cell", "membrane", "synapse", "pump", "protein", "molecule", "anatomy",
  "cross", "section", "illustration", "fig", "chart", "graph", "svg",
];
```

### Observed Wikipedia thumbnail filenames (10 articles)

| Article | Thumbnail filename | Result |
|---|---|---|
| Mitochondrion | `Animal_mitochondrion_diagram_en.svg` | **PASS** ("diagram") |
| Synapse | `Synapse_figure.png` | **PASS** ("synapse") |
| Krebs cycle | *(no thumbnail returned)* | N/A |
| Myosin | `Myosine.gif` | Blocked by GIF rule (correct) |
| Action potential | `Action_Potential.gif` | Blocked by GIF rule (correct) |
| Neuron | `Blausen_0657_MultipolarNeuron.png` | **REJECTED** — no require word |
| Neuromuscular junction | `Neuro_Muscular_Junction.png` | **REJECTED** — no require word |
| Axon | `Blausen_0657_MultipolarNeuron.png` | **REJECTED** — no require word |
| Endoplasmic reticulum | `Blausen_0350_EndoplasmicReticulum.png` | **REJECTED** — no require word |
| Hippocampus | `Gray739-emphasizing-hippocampus.png` | **REJECTED** — no require word |

**5 of 8 non-GIF images are silently discarded.** Wikipedia's medical illustration library uses two dominant naming conventions that match zero require-list words:
- Blausen Medical collection: `Blausen_NNNN_SubjectName.png`
- Gray's Anatomy scans: `GrayNNN-subjectname.png`

The `FILENAME_REQUIRE` guard was designed to block non-scientific stock images, but it over-filters legitimate scientific diagrams whose filenames happen to be anatomically descriptive rather than visually descriptive.

### Recommendation

**Option A (minimal fix):** Add common scientific illustration series names to `FILENAME_REQUIRE`:
```ts
"blausen", "gray", "sobotta", "netter",
```

**Option B (correct fix):** Remove `FILENAME_REQUIRE` entirely. The `FILENAME_REJECT` list already handles the noise cases (flags, logos, portraits, maps). The require check adds a second gate that blocks legitimate content. Reject-only is simpler and more robust.

---

## Path 2: pdfjs-dist worker hack — VERDICT: PASS

### What was checked
Whether `GlobalWorkerOptions.workerSrc = ""` (empty string) is set at module scope.

### Finding
The described empty-string hack does **not exist** in the codebase. The actual implementation in `app/lib/pdfExtract.ts`:

```ts
const WORKER_URL = "/pdf.worker.min.js";                    // line 20
// ...
pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;        // line 34
```

The worker is self-hosted: `/public/pdf.worker.min.js` exists on disk. pdfjs-dist is **not bundled** via package.json — it is loaded at runtime via a CDN `<Script>` tag in `app/layout.tsx`:

```
src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
```

The cMapUrl in pdfExtract.ts references the same pinned version (`pdfjs-dist@3.11.174`), so the worker and library are version-matched. No hack, no mismatch.

The audit prompt describes either a historical state that was already corrected or a hypothetical concern. No action required.

---

## Path 3: repairJson three-tier fallback — VERDICT: FIX

### What was checked
The `repairJson` + `extractJson` three-tier fallback in `app/api/generate/route.ts` (lines 136–205), tested against three synthetic broken-JSON inputs.

### Test inputs and results

```
Input 1 — Truncated mid-array (missing ']'):
  [{"front":"q1","back":"a1"},{"front":"q2","back":"a2"}
  Result: NO_ARRAY_MATCH — regex fails before any tier runs

Input 2 — Truncated mid-object (missing value, '}', and ']'):
  [{"front":"q1","back":"a1"},{"front":"q2","back":
  Result: NO_ARRAY_MATCH — regex fails before any tier runs

Input 3 — Truncated mid-string (missing closing '"', '}', ']'):
  [{"front":"q1","back":"this is a long answe
  Result: NO_ARRAY_MATCH — regex fails before any tier runs
```

### Root cause
`extractJson` begins with:
```ts
const match = raw.match(/\[[\s\S]*\]/);
if (!match) throw new Error("No JSON array found in model response");
```

The regex requires **both** a `[` and a `]`. When Gemini hits `maxOutputTokens: 8192` mid-generation, the response may end without the closing `]`. In that case, `extractJson` throws "No JSON array found" immediately — the three tiers (direct parse → repairJson → truncate-to-last-`}`) are **never reached**.

The three-tier system only activates when the response contains a syntactically complete array bracket pair but malformed interior content (e.g., unescaped quotes, control characters). It provides no recovery path for the arguably more common real-world failure: token-limit truncation before `]`.

### Recommendation
Add a pre-pass before the regex match that appends a synthetic close if needed:

```ts
function closeArray(raw: string): string {
  const open = raw.lastIndexOf("[");
  if (open === -1) return raw;
  // If the last '[' has no matching ']' after it, close the array.
  if (raw.indexOf("]", open) === -1) {
    // Clip to last complete object (last '}'), then close.
    const lastClose = raw.lastIndexOf("}");
    if (lastClose > open) return raw.slice(0, lastClose + 1) + "]";
    return raw + "]";
  }
  return raw;
}
```

Call `closeArray(raw)` before the regex match in `extractJson`. This allows Inputs 1 and 2 (truncated mid-array, truncated mid-object) to enter Tier 3 and recover all complete objects. Input 3 (truncated mid-string) still loses the incomplete card, but recovers all prior complete objects.

---

## Path 4: Tally feedback forms — VERDICT: PASS

### What was checked
HTTP availability and page content of both Tally form URLs embedded in the codebase.

### Results

| URL | HTTP status | Page title |
|---|---|---|
| `https://tally.so/r/b5YPre` | **200 OK** | "General Feedback" |
| `https://tally.so/r/NpbkBW` | **200 OK** | "Report a Bad Deck" |

Both forms return valid HTML shells. Tally renders form fields client-side via JavaScript; the SSR shell is the correct indicator of form availability — a 200 with proper `<title>` confirms the form record exists and Tally's embed pipeline is intact.

The flag link in `app/api/generate/route.ts` (line 354) correctly references `NpbkBW` with a `?card=` query parameter for pre-filling the reported card. No regression.

---

## Summary

| Path | Verdict | Priority |
|---|---|---|
| 1. Wikimedia FILENAME_REQUIRE | **FIX** | High — silently discards 60%+ of legitimate Wikipedia anatomy diagrams |
| 2. pdfjs worker hack | **PASS** | — |
| 3. repairJson three-tier fallback | **FIX** | Medium — token-limit truncation yields 0 cards; a one-function pre-pass fixes it |
| 4. Tally feedback forms | **PASS** | — |
