# POST /api/embed-preset

`app/api/embed-preset/route.ts` — `maxDuration: 30`

## Request shape

`multipart/form-data`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `apkg` | File | yes | The `.apkg` to patch |
| `preset` | string | yes | JSON-serialized `AnkiPreset` object |

## Processing pipeline (SQLite patching strategy)

1. **Unzip** the `.apkg` with JSZip; extract `collection.anki2` as `Uint8Array`
2. **Open SQLite** with `sql.js` (`require("sql.js")` — CommonJS, needed for Vercel serverless)
3. **Read** `SELECT dconf, decks FROM col WHERE id = 1` — `dconf` and `decks` are JSON strings
4. **Allocate new config ID**: `Math.max(...Object.keys(dconf).map(k => parseInt(k, 10))) + 1`
   - This ensures `dconf["1"]` (Anki's shared Default preset) is **never overwritten or modified**; any existing user presets are also preserved since the new ID is always `max + 1`
5. **Build new dconf entry** via `buildDconfEntry(newConfigId, preset)`:
   - Maps `AnkiPreset` fields to Anki's internal schema (new/rev/lapse objects)
   - Learning/relearning steps: `parseStepsToMinutes` converts strings like `"1m 10m"`, `"1h"`, `"30s"`, `"1d"` to float minutes
   - `fsrsEnabled: true`, `desiredRetention: preset.desired_retention`, `fsrsParams5: []` (empty = Anki uses built-in FSRS-5 weights)
   - `leechAction`: `"suspend"` → `0`, anything else → `1` (tag only)
   - `insertion_order`: `"sequential"` → `1`, anything else → `0` (random)
6. **Point non-Default decks** at the new config: iterate `decks` entries, skip `deckId === "1"` and `deck.name === "Default"`, set `deck.conf = newConfigId` on everything else
7. **Write back**: `UPDATE col SET dconf = :dconf, decks = :decks WHERE id = 1`
8. **Export** patched DB bytes with `db.export()`, close connection
9. **Re-zip**: copy all files from original zip, replacing `collection.anki2` with patched bytes; compress with `DEFLATE`

## Why dconf["1"] is not touched

`dconf["1"]` is Anki's global Default deck configuration shared by the built-in Default deck. Modifying it would change settings for cards in the Default deck and potentially affect all other user decks that haven't been assigned a custom preset. By always allocating a new ID (`max + 1`), the route creates an isolated "Anki Generator" preset that only applies to the generated deck's non-Default decks.

## Response shape

Binary `.apkg` on success:

| Header | Value |
|---|---|
| `Content-Type` | `application/octet-stream` |
| `Content-Disposition` | `attachment; filename="anki_deck_with_settings.apkg"` |

The caller (`SettingsRecommender.PresetDisplay.handleEmbedDownload`) renames the file to `{original_basename}_with_settings.apkg` before triggering the browser download.

## Failure modes

| Condition | Status | Notes |
|---|---|---|
| Missing `apkg` or `preset` field | 400 | `{ error: "Missing apkg or preset" }` |
| Invalid request body (parse error) | 400 | `{ error: "Invalid request body" }` |
| `collection.anki2` not in zip | 500 | `{ error: "Preset embed failed: collection.anki2 not found in .apkg" }` |
| `col` table empty | 500 | `{ error: "Preset embed failed: col table is empty" }` |
| Any other exception | 500 | `{ error: "Preset embed failed: {message}" }` |
