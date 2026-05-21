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

function isValidPreset(p: unknown): p is AnkiPreset {
  if (typeof p !== "object" || p === null) return false;
  const r = p as Record<string, unknown>;
  if (typeof r.new_cards_per_day !== "number" || !isFinite(r.new_cards_per_day)) return false;
  if (typeof r.maximum_reviews_per_day !== "number" || !isFinite(r.maximum_reviews_per_day)) return false;
  if (typeof r.learning_steps !== "string") return false;
  if (typeof r.graduating_interval !== "number" || !isFinite(r.graduating_interval)) return false;
  if (typeof r.easy_interval !== "number" || !isFinite(r.easy_interval)) return false;
  if (r.insertion_order !== "sequential" && r.insertion_order !== "random") return false;
  if (typeof r.relearning_steps !== "string") return false;
  if (typeof r.minimum_interval !== "number" || !isFinite(r.minimum_interval)) return false;
  if (typeof r.leech_threshold !== "number" || !isFinite(r.leech_threshold)) return false;
  if (r.leech_action !== "tag_only" && r.leech_action !== "suspend") return false;
  if (r.fsrs_enabled !== true) return false;
  if (typeof r.desired_retention !== "number" || !isFinite(r.desired_retention) ||
      r.desired_retention < 0 || r.desired_retention > 1) return false;
  if (typeof r.maximum_interval !== "number" || !isFinite(r.maximum_interval)) return false;
  return true;
}

function parseStepsToMinutes(steps: string): number[] {
  return steps.split(/\s+/).filter(Boolean).map((tok) => {
    if (tok.endsWith("m")) return parseFloat(tok);
    if (tok.endsWith("h")) return parseFloat(tok) * 60;
    if (tok.endsWith("s")) return parseFloat(tok) / 60;
    if (tok.endsWith("d")) return parseFloat(tok) * 1440;
    return parseFloat(tok);
  });
}

function buildDconfEntry(configId: number, preset: AnkiPreset): Record<string, unknown> {
  return {
    id: configId,
    name: "highyield.cards",
    mod: Math.floor(Date.now() / 1000),
    usn: -1,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    new: {
      delays: parseStepsToMinutes(preset.learning_steps),
      ints: [preset.graduating_interval, preset.easy_interval, 7],
      initialFactor: 2500,
      order: preset.insertion_order === "sequential" ? 1 : 0,
      perDay: preset.new_cards_per_day,
      bury: false,
    },
    rev: {
      perDay: preset.maximum_reviews_per_day,
      ease4: 1.3,
      ivlFct: 1.0,
      maxIvl: preset.maximum_interval,
      bury: false,
      hardFactor: 1.2,
    },
    lapse: {
      delays: parseStepsToMinutes(preset.relearning_steps),
      mult: 0.0,
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
    fsrsEnabled: true,
    desiredRetention: preset.desired_retention,
    fsrsParams5: [], // empty → Anki uses default FSRS-5 weights
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
        return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
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
  try {
    // Unzip the .apkg
    const zip = await JSZip.loadAsync(apkgBytes);
    const dbFile = zip.file("collection.anki2");
    if (!dbFile) throw new Error("collection.anki2 not found in .apkg");
    const dbBytes = new Uint8Array(await dbFile.async("arraybuffer"));

    // Open existing SQLite database
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const initSqlJs = require("sql.js") as () => Promise<SqlModule>;
    const SQL = await initSqlJs();
    const db = new SQL.Database(dbBytes);

    // Read current dconf and decks
    const rows = db.exec("SELECT dconf, decks FROM col WHERE id = 1");
    if (!rows.length || !rows[0].values.length) throw new Error("col table is empty");
    const [dconfJson, decksJson] = rows[0].values[0] as [string, string];
    const dconf = JSON.parse(dconfJson) as Record<string, unknown>;
    const decks = JSON.parse(decksJson) as Record<string, Record<string, unknown>>;

    // Allocate a new config ID so dconf["1"] (the shared Default) is never touched.
    const newConfigId = Math.max(...Object.keys(dconf).map(k => parseInt(k, 10))) + 1;
    dconf[String(newConfigId)] = buildDconfEntry(newConfigId, preset);

    // Point only our non-Default decks at the new config.
    for (const [deckId, deck] of Object.entries(decks)) {
      if (deckId !== "1" && deck["name"] !== "Default") {
        deck["conf"] = newConfigId;
      }
    }

    // Write back
    db.run("UPDATE col SET dconf = :dconf, decks = :decks WHERE id = 1", {
      ":dconf": JSON.stringify(dconf),
      ":decks": JSON.stringify(decks),
    });

    const patchedDb = db.export();
    db.close();

    // Re-zip, replacing collection.anki2
    const newZip = new JSZip();
    for (const [name, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      if (name === "collection.anki2") {
        newZip.file(name, patchedDb);
      } else {
        newZip.file(name, await file.async("uint8array"));
      }
    }

    const outBuffer = await newZip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    patchedBytes = outBuffer;
  } catch (err) {
    console.error("[embed-preset] Processing error:", err);
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
