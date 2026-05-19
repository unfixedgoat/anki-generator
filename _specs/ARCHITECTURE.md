# Architecture

This is a Next.js 16 app-router application (React 19, TypeScript, Tailwind CSS v4) deployed as a serverless function. The left column renders `DropZone` (PDF upload or text paste → calls `/api/generate` → downloads `.apkg`); the right column renders `SettingsRecommender` (pure client-side calculation of Anki deck settings, optionally calling `/api/embed-preset` to bake those settings into the `.apkg`). Shared state is a single `GenerationInfo` object owned by `page.tsx` and passed down as props. Design tokens are an amber palette (`#c97f1a` active amber, `#7a4f0d` dark amber text, `#f0c87a`/`#fef8ee`/`#fffdf7` amber tints) over slate neutrals; all tokens are Tailwind arbitrary-value classes, not CSS variables.

## API Routes

| Route | Purpose |
|---|---|
| `POST /api/generate` | Receives text + style/density → calls Gemini → enriches visuals → returns `.apkg` |
| `POST /api/embed-preset` | Receives `.apkg` + preset JSON → patches SQLite → returns new `.apkg` |

## Runtime-critical dependencies

| Package | Used for |
|---|---|
| `@google/genai` | Gemini 2.5 Flash card generation |
| `jszip` | Reading and writing `.apkg` zip archives |
| `sql.js` | Opening `collection.anki2` SQLite inside serverless functions |
| `lucide-react` | Icon set (CheckCircle2, AlertCircle, Loader2, Upload, X) |
| `next` | Framework, app router, serverless API routes |
| `react` / `react-dom` | UI runtime |
