import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { auth } from "@clerk/nextjs/server";
import { ratelimit, isPro } from "@/app/lib/ratelimit";
import { type AnkiPreset } from "@/app/lib/settingsRecommender";

export const maxDuration = 30;

interface SqlDatabase {
  run(sql: string, params?: Record<string, unknown>): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  export(): Uint8Array;
  close(): void;
}

interface SqlModule {
  Database: new (data?: Uint8Array) => SqlDatabase;
}

const ALLOWED_PRESET_KEYS = new Set([
  "new_cards_per_day", "maximum_reviews_per_day", "new_cards_ignore_review_limit",
  "limits_start_from_top", "learning_steps", "insertion_order", "relearning_steps",
  "minimum_interval", "leech_threshold", "leech_action", "desired_retention",
  "maximum_interval", "estimated_daily_new_cards", "estimated_finish_date",
  "warnings", "rationale", "fsrs_enabled", "graduating_interval", "easy_interval",
]);

function isValidPreset(p: unknown): p is AnkiPreset {
  if (typeof p !== "object" || p === null) return false;
  const r = p as Record<string, unknown>;
  if (Object.keys(r).some(k => !ALLOWED_PRESET_KEYS.has(k))) return false;
  // Fields required by both FsrsOnPreset and Sm2Preset
  if (typeof r.new_cards_per_day !== "number" || !isFinite(r.new_cards_per_day)) return false;
  if (typeof r.maximum_reviews_per_day !== "number" || !isFinite(r.maximum_reviews_per_day)) return false;
  if (typeof r.learning_steps !== "string") return false;
  if (r.insertion_order !== "sequential" && r.insertion_order !== "random") return false;
  if (typeof r.relearning_steps !== "string") return false;
  if (typeof r.minimum_interval !== "number" || !isFinite(r.minimum_interval)) return false;
  if (typeof r.leech_threshold !== "number" || !isFinite(r.leech_threshold)) return false;
  if (r.leech_action !== "tag_only" && r.leech_action !== "suspend") return false;
  if (r.fsrs_enabled !== true && r.fsrs_enabled !== false) return false;
  if (typeof r.desired_retention !== "number" || !isFinite(r.desired_retention) ||
      r.desired_retention < 0 || r.desired_retention > 1) return false;
  if (typeof r.maximum_interval !== "number" || !isFinite(r.maximum_interval)) return false;
  // SM-2 only: graduating_interval and easy_interval are required when FSRS is off
  if (r.fsrs_enabled === false) {
    if (typeof r.graduating_interval !== "number" || !isFinite(r.graduating_interval)) return false;
    if (typeof r.easy_interval !== "number" || !isFinite(r.easy_interval)) return false;
  }
  return true;
}

// collection.anki2 stores delays in minutes — convert user-facing step strings accordingly.
function parseStepsToMinutes(steps: string): number[] {
  return steps.split(/\s+/).filter(Boolean).map((tok) => {
    if (tok.endsWith("m")) return parseFloat(tok);
    if (tok.endsWith("h")) return parseFloat(tok) * 60;
    if (tok.endsWith("s")) return parseFloat(tok) / 60;
    if (tok.endsWith("d")) return parseFloat(tok) * 1440;
    return parseFloat(tok);
  });
}

function buildDconfEntry(configId: number, preset: AnkiPreset, deckName: string): Record<string, unknown> {
  // new.ints = [graduating_interval, easy_interval, legacy_easy_interval].
  // FSRS branch: Anki ignores these for scheduling but displays them in the UI.
  //   Write neutral display values from local constants — FsrsOnPreset intentionally
  //   omits graduating_interval / easy_interval so there is nothing mode-specific to leak.
  // SM-2 branch: TypeScript narrows preset to Sm2Preset here, making these fields
  //   available as load-bearing schedule inputs.
  const smInts: [number, number, number] = preset.fsrs_enabled
    ? [1, 4, 7]
    : [preset.graduating_interval, preset.easy_interval, 7];

  return {
    id: configId,
    name: deckName,
    mod: Math.floor(Date.now() / 1000),
    usn: -1,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    new: {
      delays: parseStepsToMinutes(preset.learning_steps),
      ints: smInts,
      // initialFactor (SM-2 starting ease) and the rev SM-2 multipliers below are
      // at Anki's own defaults and are ignored by FSRS, so they need no branching.
      initialFactor: 2500,
      order: preset.insertion_order === "sequential" ? 1 : 0,
      perDay: preset.new_cards_per_day,
      bury: false,
    },
    rev: {
      perDay: preset.maximum_reviews_per_day,
      ease4: 1.3,     // SM-2 easy bonus — ignored by FSRS
      ivlFct: 1.0,    // SM-2 interval modifier — ignored by FSRS
      maxIvl: preset.maximum_interval,
      bury: false,
      hardFactor: 1.2, // SM-2 hard multiplier — ignored by FSRS
    },
    lapse: {
      delays: parseStepsToMinutes(preset.relearning_steps),
      mult: 0.0,       // SM-2 new-interval percentage — ignored by FSRS
      minInt: preset.minimum_interval,
      leechFails: preset.leech_threshold,
      leechAction: preset.leech_action === "suspend" ? 0 : 1,
    },
    dyn: false,
    newMix: 0,
    newPerDayMinimum: 0,
    interdayLearningMix: 0,
    reviewOrder: 0,
    newSortOrder: 0,
    newGatherPriority: 0,
    buryInterdayLearning: false,
    // FSRS is a PROFILE-level setting in Anki (Preferences → Review → FSRS).
    // This dconf field has no effect — it cannot enable FSRS for the user.
    // desiredRetention IS read per-deck-config by Anki once FSRS is enabled at
    // the profile level, so that field is still meaningful to write here.
    fsrsEnabled: preset.fsrs_enabled,
    desiredRetention: preset.desired_retention,
    fsrsParams5: [], // empty → Anki uses default FSRS weights
  };
}

export async function POST(req: NextRequest) {
  // Guard 1 — file size: reject before reading body if Content-Length is missing or > 50 MB.
  const contentLengthHeader = req.headers.get("content-length");
  if (!contentLengthHeader || Number(contentLengthHeader) > 52_428_800) {
    return NextResponse.json({ error: "Request too large or missing Content-Length" }, { status: 413 });
  }

  // Guard 2 — rate limiting for anonymous callers (authenticated users pass freely).
  const { userId } = await auth();
  if (!userId) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }
    const forwarded = req.headers.get("x-forwarded-for") ?? "";
    const realIp = forwarded.split(",").at(-1)?.trim() || "anonymous";
    const pro = await isPro(realIp);
    if (!pro) {
      const { success } = await ratelimit.limit(realIp);
      if (!success) {
        return NextResponse.json({ error: "Free limit reached" }, { status: 429 });
      }
    }
  }

  let apkgBytes: Uint8Array;
  let preset: AnkiPreset;

  try {
    const form = await req.formData();
    const apkgFile = form.get("apkg") as File | null;
    const presetJson = form.get("preset") as string | null;
    if (!apkgFile || !presetJson) {
      return NextResponse.json({ error: "Missing apkg or preset" }, { status: 400 });
    }
    apkgBytes = new Uint8Array(await apkgFile.arrayBuffer());
    // Guard 3 — preset field validation before any file processing.
    const parsedPreset: unknown = JSON.parse(presetJson);
    if (!isValidPreset(parsedPreset)) {
      return NextResponse.json({ error: "Invalid preset fields" }, { status: 400 });
    }
    preset = parsedPreset;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let patchedBytes: Uint8Array;

  // Phase 1: unzip — malformed archive is a client error.
  const zip = await JSZip.loadAsync(apkgBytes).catch(() => null);
  if (!zip) {
    return NextResponse.json({ error: "Uploaded file is not a valid zip archive" }, { status: 400 });
  }

  // Phase 2: locate collection.anki2 — missing file is a client error.
  const dbFilename = "collection.anki2";
  const dbFile = zip.file(dbFilename);
  if (!dbFile) {
    return NextResponse.json({ error: "No collection.anki2 found in uploaded file" }, { status: 400 });
  }
  const dbBytes = new Uint8Array(await dbFile.async("arraybuffer"));

  // Validate SQLite magic bytes before handing the buffer to sql.js.
  // sql.js's Database constructor accepts bad data silently and only throws
  // later on exec(), so check the first 16 bytes ourselves — client error.
  const SQLITE_MAGIC = Buffer.from("SQLite format 3\0");
  if (dbBytes.length < 16 || !SQLITE_MAGIC.equals(Buffer.from(dbBytes.slice(0, 16)))) {
    return NextResponse.json({ error: "Invalid Anki file. Try regenerating the deck." }, { status: 400 });
  }

  // Phase 3: open SQLite — corrupted bytes are a client error.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const initSqlJs = require("sql.js") as () => Promise<SqlModule>;
  const SQL = await initSqlJs();
  // Definite assignment: phase 3 either assigns db or returns 400.
  let db!: SqlDatabase;
  try {
    db = new SQL.Database(dbBytes);
  } catch {
    return NextResponse.json({ error: "Invalid Anki file. Try regenerating the deck." }, { status: 400 });
  }

  // Phase 4: patch dconf and re-export — unexpected failures here are server errors.
  try {
    // Read current dconf and decks
    const rows = db.exec("SELECT dconf, decks FROM col WHERE id = 1");
    if (!rows.length || !rows[0].values.length) throw new Error("col table is empty");
    const [dconfJson, decksJson] = rows[0].values[0] as [string, string];
    const dconf = JSON.parse(dconfJson) as Record<string, unknown>;
    const decks = JSON.parse(decksJson) as Record<string, Record<string, unknown>>;

    // Strip any previously-embedded configs so the uploaded .apkg is always
    // treated as clean. Without this, re-uploading an already-embedded file
    // would accumulate orphan config entries and keep incrementing the ID,
    // while re-uploading the original would always produce ID 2 — both cases
    // risk Anki silently skipping a config update on re-import.
    for (const key of Object.keys(dconf)) {
      if (key !== "1") delete dconf[key];
    }

    // Use a timestamp-based ID (same scheme Anki uses) so each export gets a
    // unique config ID. max+1 always produces 2, which Anki already has from any
    // prior import and silently reuses — ignoring the new settings entirely.
    const newConfigId = Math.floor(Date.now() / 1000);

    // Name the config after the deck so it's identifiable in Anki's UI.
    const primaryDeckName = Object.entries(decks)
      .filter(([id, d]) => id !== "1" && d["name"] !== "Default")
      .map(([, d]) => d["name"] as string)[0] ?? "highyield.cards";

    dconf[String(newConfigId)] = buildDconfEntry(newConfigId, preset, primaryDeckName);

    // Point only our non-Default decks at the new config.
    // Preserve the type of the existing conf value (string in some older exports).
    for (const [deckId, deck] of Object.entries(decks)) {
      if (deckId !== "1" && deck["name"] !== "Default") {
        deck["conf"] = typeof deck["conf"] === "string" ? String(newConfigId) : newConfigId;
        console.error("[embed-preset] Deck conf field:", JSON.stringify(deck["conf"]), "newConfigId:", newConfigId);
      }
    }

    console.error("[embed-preset] Writing dconf:", JSON.stringify(dconf));

    // Write back
    db.run("UPDATE col SET dconf = :dconf, decks = :decks WHERE id = 1", {
      ":dconf": JSON.stringify(dconf),
      ":decks": JSON.stringify(decks),
    });

    const patchedDb = db.export();
    db.close();

    // Re-zip, replacing the patched database file
    const newZip = new JSZip();
    for (const [name, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      if (name === dbFilename) {
        newZip.file(name, patchedDb);
      } else {
        newZip.file(name, await file.async("uint8array"));
      }
    }

    console.error("[embed-preset] Zip files:", Object.keys(newZip.files));
    const outBuffer = await newZip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    patchedBytes = outBuffer;
  } catch (err) {
    console.error("[embed-preset] Processing error:", err);
    try { db.close(); } catch { /* already closed */ }
    return NextResponse.json({ error: "Export failed. Please try again." }, { status: 500 });
  }

  return new Response(patchedBytes.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="anki_deck_with_settings.apkg"`,
    },
  });
}
