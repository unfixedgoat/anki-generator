# visualEnricher

`app/lib/visualEnricher.ts`

Called by `/api/generate` after `extractJson`. Receives `RawCard[]`, returns `EnrichedCard[]` (all cards processed in parallel via `Promise.all`).

## Exported types

```ts
type VisualType = "mermaid" | "quickchart" | "wikimedia" | "none";

interface RawCard { front, back, card_type, citation, visual_type?, visual_data? }
interface EnrichedCard extends Omit<RawCard, "visual_type"|"visual_data"> { visual_url? }
```

## Three visual_type handlers

### mermaid

- `buildVisualUrl("mermaid", data)` → base64-encodes the Mermaid syntax string with `Buffer.from(data, "utf-8").toString("base64")` → constructs `https://mermaid.ink/img/{base64}`
- `fetchAsDataUri(url)` downloads the PNG, validates content-type starts with `"image/"`, checks size ≤ 400 KB, converts to `data:image/png;base64,{b64}`
- Fetch timeout: 8 seconds (`AbortSignal.timeout(8000)`)

### quickchart

- `buildVisualUrl("quickchart", data)` → URL-encodes the Chart.js config JSON → constructs `https://quickchart.io/chart?c={encoded}`
- Same `fetchAsDataUri` path as mermaid
- Only used when the source text contains actual numbers — Gemini's prompt forbids inventing chart data

### wikimedia

Two-layer validation via `fetchWikimediaUrl(searchTerm)`:

**Layer 1 — Article filtering:**
1. If the search term doesn't already contain a word from `BIAS_TERMS` (`["diagram", "pathway", "structure", "cycle"]`), append `" diagram"` to bias results toward scientific figures
2. Wikipedia search API: `action=query&list=search&srlimit=5` — fetches top 5 article candidates
3. Filter candidates against `SKIP_SUFFIXES` — reject any article whose title ends with ` (film)`, ` (movie)`, ` (TV series)`, ` (series)`, ` (album)`, ` (song)`, ` (band)`, ` (company)`, ` (brand)`, ` (disambiguation)`, ` (novel)`, ` (video game)`, ` (game)`, ` (character)`, ` (comics)`
4. Require at least one significant word from the query (length > 3) to appear in the article title — prevents unrelated articles from sneaking through

**Layer 2 — Filename filtering (via `isAcceptableImageUrl`):**
- Batch-fetch thumbnails for all surviving candidates in a single `prop=pageimages&pithumbsize=800` call
- For each candidate (in original search-rank order), check the thumbnail URL filename:
  - **Reject** `.gif` files
  - **Reject** if filename contains any `FILENAME_REJECT` word: `flag`, `coat`, `arms`, `logo`, `icon`, `portrait`, `photo`, `map_of`, `locator`, `seal`, `emblem`, `crest`, `person`, `people`, `building`, `landscape`
  - **Require** at least one `FILENAME_REQUIRE` word: `diagram`, `scheme`, `pathway`, `structure`, `cycle`, `receptor`, `channel`, `cell`, `membrane`, `synapse`, `pump`, `protein`, `molecule`, `anatomy`, `cross`, `section`, `illustration`, `fig`, `chart`, `graph`, `svg`
- Return the first candidate passing both checks

After a URL is found, `fetchAsDataUri` converts it to a base64 data URI with the same 400 KB / 8s constraints as the other handlers.

## What gets appended to the back field

When a visual is successfully resolved, the card's `back` becomes:

```
{original back}<br/><img src="{dataUri}" alt="visual" style="max-width:100%;margin-top:0.75em;" />
```

The `visual_url` field on the `EnrichedCard` stores the original source URL (Wikimedia thumbnail URL, mermaid.ink URL, or quickchart.io URL) for debugging/reference.

## Constraints

| Constraint | Value |
|---|---|
| Max image size | 400 KB (`MAX_IMAGE_BYTES = 400_000`) |
| Fetch timeout | 8 seconds per request |
| Wikipedia search results | Top 5 (`srlimit=5`) |
| Thumbnail size requested | 800px wide (`pithumbsize=800`) |

## Failure behavior

If any step in the resolution chain returns `null` (network error, no matching article, image too large, filename rejected), the card is returned unchanged — `back` is unmodified, `visual_url` is omitted. Failures are silent (caught internally); they never propagate to the caller.
