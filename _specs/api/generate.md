# POST /api/generate

`app/api/generate/route.ts` — `maxDuration: 60`

## Request shape

`multipart/form-data` with these fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | string | yes | Source document text |
| `style` | string | yes | One of the 8 `CardStyle` values |
| `density` | string | yes | One of: `high-yield`, `comprehensive`, `granular` |
| `filename` | string | no | Used to name the deck; `.pdf` suffix stripped |
| `customPrompt` | string | conditional | Required when `style === "custom"` |

## Processing pipeline (in order)

1. **FormData parse** — resolve `densityKey`, `styleModifier`, `documentText`, `deckName`
2. **`cardTarget(text, density)`** — word-count tier × density multiplier → integer minimum card count
   - Word-count breakpoints: <300→10, <800→20, <2000→40, <5000→65, <10000→100, <20000→140, else→180
   - Multipliers: high-yield×0.5, comprehensive×1.0, granular×1.5
3. **`buildSystemInstruction(styleModifier)`** — assembles Gemini system prompt; `styleModifier` is injected at the `CARD FORMAT` section
4. **Gemini call** — `gemini-2.5-flash`, `maxOutputTokens: 8192`, `temperature: 0.4`; user message is `"Generate at least N flashcards… DENSITY: {densityModifier}\n\n{documentText}"`
5. **`extractJson(raw)`** — three-tier fallback:
   - Tier 1: `JSON.parse(matched array string)`
   - Tier 2: `JSON.parse(repairJson(jsonStr))` — fixes unescaped quotes and raw control chars
   - Tier 3: truncate to last `}`, append `]`, then `JSON.parse(repairJson(truncated))`
   - Rethrows original error if all three fail
   - After parsing: `stripMarkdown` applied to all `front` and `back` fields
6. **`enrichCards(rawCards)`** — resolves `visual_type`/`visual_data` to base64 data URIs and appends `<img>` to `back` (see `_specs/lib/visualEnricher.md`)
7. **`buildApkg(deckName, cards)`** — packages into `.apkg` (zip containing SQLite `collection.anki2`)

## Where density and style are injected

- **Style**: `STYLE_MODIFIERS[rawStyle]` is selected → passed to `buildSystemInstruction` → embedded verbatim at the `CARD FORMAT — this is your primary instruction` line in the system prompt
- **Density**: `DENSITY_MODIFIERS[densityKey]` string appears in the user message as `DENSITY: {densityModifier}`, alongside the card-count floor
- For `style === "custom"`: `styleModifier` is built as `"CUSTOM CARD FORMAT — follow these instructions exactly, they override all defaults:\n{customPrompt}"`

## Response shape

Binary `.apkg` on success:

| Header | Value |
|---|---|
| `Content-Type` | `application/octet-stream` |
| `Content-Disposition` | `attachment; filename="{sanitized_deckname}.apkg"` |
| `X-Card-Count` | Number of enriched cards as string |
| `X-Density` | The resolved density key |
| `Access-Control-Expose-Headers` | `X-Card-Count, X-Density` |

## Failure modes

| Condition | Status | Notes |
|---|---|---|
| `GEMINI_API_KEY` not set | 500 | Checked before anything else |
| `text` field missing/empty | 400 | Returns `{ error: "No text provided" }` |
| FormData parse fails | 400 | Returns `{ error: "Failed to read form data" }` |
| Gemini throws / timeout | 502 | `{ error: "Gemini request failed: {message}" }` |
| `extractJson` fails all tiers | 502 | Rethrows the Gemini error path |
| `enrichCards` throws | 500 | `{ error: "Visual enrichment failed: {message}" }` |
| `buildApkg` throws | 500 | `{ error: "Anki export failed: {message}" }` |
| Zero cards after enrichment | 422 | `{ error: "No flashcards could be generated…" }` |

## repairJson heuristic

Scans the raw JSON string character-by-character tracking string context. For a `"` that looks like a closing quote, it peeks at the next non-whitespace character: if it is `:`, `,`, `}`, or `]` it closes the string; otherwise it escapes the `"` as `\"`. Raw control characters inside strings are converted to `\n`, `\r`, `\t`, or `\uXXXX` escape sequences.
