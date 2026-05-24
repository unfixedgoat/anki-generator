/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Embed-Preset Test Suite
 * Verifies /api/embed-preset writes correct SQLite dconf values for each preset variant.
 *
 * All 6 cases (FSRS-on × 4, FSRS-off × 2) POST a preset + minimal synthetic .apkg
 * to the API and assert dconf fields in the response match the preset.
 *
 * Requires dev server on localhost:3000 (npm run dev).
 */

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");
const JSZip = require("jszip") as typeof import("jszip");
const initSqlJs = require("sql.js") as () => Promise<SqlJsStatic>;
const { computePreset } = require("../app/lib/settingsRecommender") as typeof import("../app/lib/settingsRecommender");

// ── Types ──────────────────────────────────────────────────────────────────

type AnkiPreset = import("../app/lib/settingsRecommender").AnkiPreset;

interface SqlResultSet {
  columns: string[];
  values: unknown[][];
}

interface SqlDatabase {
  run(sql: string, params?: Record<string, unknown>): void;
  exec(sql: string): SqlResultSet[];
  export(): Uint8Array;
  close(): void;
}

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlDatabase;
}

interface TestCase {
  name: string;
  desc: string;
  preset: AnkiPreset;
}

interface TestResult {
  name: string;
  desc: string;
  pass: boolean;
  failures: string[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const BASE_URL = "http://localhost:3000";
const SNAPSHOTS_DIR = path.join(__dirname, "_snapshots");

// Unique per-run identifier used as x-forwarded-for so each run gets its own
// rate-limit bucket (the endpoint limits 5 req / 30 d per identifier).
const RUN_ID = `test-embed-${Date.now()}`;

// The Default config written into the synthetic .apkg.
// Must be unchanged by embed-preset in every test case.
const DEFAULT_DCONF_ENTRY: Record<string, unknown> = {
  id: 1,
  name: "Default",
  mod: 0,
  usn: 0,
  maxTaken: 60,
  autoplay: true,
  timer: 0,
  replayq: true,
  new: { delays: [1, 10], ints: [1, 4, 4], initialFactor: 2500, order: 1, perDay: 20, bury: false },
  rev: { perDay: 200, ease4: 1.3, ivlFct: 1.0, maxIvl: 36500, bury: false, hardFactor: 1.2 },
  lapse: { delays: [10], mult: 0.0, minInt: 1, leechFails: 8, leechAction: 0 },
  dyn: false,
};

const DEFAULT_DECKS: Record<string, unknown> = {
  "1": {
    id: 1, name: "Default", conf: 1, mod: 0, usn: 0,
    lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0],
    collapsed: false, desc: "",
  },
  "1234567890": {
    id: 1234567890, name: "highyield.cards test", conf: 1, mod: 0, usn: 0,
    lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0],
    collapsed: false, desc: "",
  },
};

// ── Test Case Matrix ───────────────────────────────────────────────────────

function makeTestCases(): TestCase[] {
  return [
    // ── FSRS on × 4 ─────────────────────────────────────────────────────────
    {
      name: "fsrs_on_cram_medium_3d",
      desc: "FSRS on · cram · medium · 3 days",
      preset: computePreset({ deck_sizes: [50], days_until_exam: 3, goal: "cram", difficulty_self_assessment: "medium" }),
    },
    {
      name: "fsrs_on_balanced_easy_30d",
      desc: "FSRS on · balanced · easy · 30 days",
      preset: computePreset({ deck_sizes: [200], days_until_exam: 30, goal: "balanced", difficulty_self_assessment: "easy" }),
    },
    {
      name: "fsrs_on_long_term_hard_null",
      desc: "FSRS on · long_term · hard · no deadline",
      preset: computePreset({ deck_sizes: [500], days_until_exam: null, goal: "long_term", difficulty_self_assessment: "hard" }),
    },
    {
      name: "fsrs_on_exam_medium_60d",
      desc: "FSRS on · exam_then_retain · medium · 60 days",
      preset: computePreset({ deck_sizes: [300], days_until_exam: 60, goal: "exam_then_retain", difficulty_self_assessment: "medium" }),
    },
    // ── FSRS off × 2 ────────────────────────────────────────────────────────
    {
      name: "fsrs_off_balanced_easy_null",
      desc: "FSRS off · balanced · easy · no deadline",
      preset: computePreset({ deck_sizes: [100], days_until_exam: null, goal: "balanced", difficulty_self_assessment: "easy", fsrs_enabled: false }),
    },
    {
      name: "fsrs_off_cram_hard_5d",
      desc: "FSRS off · cram · hard · 5 days",
      preset: computePreset({ deck_sizes: [80], days_until_exam: 5, goal: "cram", difficulty_self_assessment: "hard", fsrs_enabled: false }),
    },
  ];
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Matches the route's parseStepsToMinutes — Anki dconf stores delays in minutes.
function parseStepsToMinutes(steps: string): number[] {
  return steps.split(/\s+/).filter(Boolean).map((tok) => {
    if (tok.endsWith("m")) return parseFloat(tok);
    if (tok.endsWith("h")) return parseFloat(tok) * 60;
    if (tok.endsWith("s")) return parseFloat(tok) / 60;
    if (tok.endsWith("d")) return parseFloat(tok) * 1440;
    return parseFloat(tok);
  });
}

// ── Synthetic .apkg ────────────────────────────────────────────────────────

async function createSyntheticApkg(SQL: SqlJsStatic): Promise<Buffer> {
  const db = new SQL.Database();

  db.run(`CREATE TABLE col (
    id INTEGER PRIMARY KEY, crt INTEGER, mod INTEGER, scm INTEGER,
    ver INTEGER, dty INTEGER, usn INTEGER, ls INTEGER,
    conf TEXT, models TEXT, decks TEXT, dconf TEXT, tags TEXT
  )`);

  db.run(
    `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
     VALUES (1, 0, 0, 0, 11, 0, 0, 0, '{}', '{}', :decks, :dconf, '{}')`,
    {
      ":decks": JSON.stringify(DEFAULT_DECKS),
      ":dconf": JSON.stringify({ "1": DEFAULT_DCONF_ENTRY }),
    },
  );

  const dbBytes = db.export();
  db.close();

  const zip = new JSZip();
  zip.file("collection.anki2", dbBytes);
  const zipBytes: Uint8Array = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return Buffer.from(zipBytes);
}

// ── API call ───────────────────────────────────────────────────────────────

async function callEmbedPreset(baseApkg: Buffer, preset: AnkiPreset, requestId: string): Promise<Buffer> {
  const form = new FormData();
  form.append("apkg", new Blob([baseApkg], { type: "application/octet-stream" }), "test.apkg");
  form.append("preset", JSON.stringify(preset));

  const res = await fetch(`${BASE_URL}/api/embed-preset`, {
    method: "POST",
    body: form,
    headers: { "x-forwarded-for": requestId },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

// ── dconf extraction ───────────────────────────────────────────────────────

async function extractDconf(
  apkg: Buffer,
  SQL: SqlJsStatic,
): Promise<Record<string, Record<string, unknown>>> {
  const zip = new JSZip();
  await zip.loadAsync(apkg);

  const dbFile = zip.file("collection.anki21b") ?? zip.file("collection.anki2");
  if (!dbFile) throw new Error("No collection.anki21b or collection.anki2 found in .apkg");

  const dbBytes: Uint8Array = await dbFile.async("uint8array");
  const db = new SQL.Database(dbBytes);

  let dconf: Record<string, Record<string, unknown>>;
  try {
    const rows = db.exec("SELECT dconf FROM col WHERE id = 1");
    if (!rows.length || !rows[0].values.length) throw new Error("col row not found");
    dconf = JSON.parse(rows[0].values[0][0] as string);
  } finally {
    db.close();
  }

  return dconf;
}

// ── Assertions ─────────────────────────────────────────────────────────────

function assertPreset(
  dconf: Record<string, Record<string, unknown>>,
  preset: AnkiPreset,
  failures: string[],
): void {
  const ids = Object.keys(dconf).map(Number).filter((id) => id !== 1);
  if (ids.length === 0) {
    failures.push("No new config found in dconf (expected at least one entry with ID > 1)");
    return;
  }
  const newId = Math.max(...ids);
  const cfg = dconf[String(newId)] as Record<string, unknown>;
  const newSec = cfg.new as Record<string, unknown>;
  const revSec = cfg.rev as Record<string, unknown>;
  const lapseSec = cfg.lapse as Record<string, unknown>;

  function check<T>(label: string, actual: T, expected: T): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  // desiredRetention — preset stores as fraction (e.g. 0.80), dconf stores same fraction
  check("desiredRetention", cfg.desiredRetention, preset.desired_retention);

  // new.delays and lapse.delays are stored in seconds (matching route's parseStepsToSeconds)
  check("new.delays", newSec.delays, parseStepsToMinutes(preset.learning_steps));
  check("lapse.delays", lapseSec.delays, parseStepsToMinutes(preset.relearning_steps));

  check("lapse.leechFails", lapseSec.leechFails, preset.leech_threshold);

  // leechAction: 0 = suspend, 1 = tag_only
  check("lapse.leechAction", lapseSec.leechAction, preset.leech_action === "suspend" ? 0 : 1);

  check("rev.maxIvl", revSec.maxIvl, preset.maximum_interval);
  check("new.perDay", newSec.perDay, preset.new_cards_per_day);
  check("rev.perDay", revSec.perDay, preset.maximum_reviews_per_day);

  // new.order: sequential = 1, random = 0
  check("new.order", newSec.order, preset.insertion_order === "sequential" ? 1 : 0);

  if (preset.fsrs_enabled) {
    // Critical regression guard: FSRS-on must always write neutral SM-2 display fallback
    // [1, 4, 7] from local constants — never leaking mode-specific graduating/easy values.
    // FsrsOnPreset intentionally omits those fields, making this the only possible path.
    check("new.ints (FSRS on → neutral SM-2 fallback)", newSec.ints, [1, 4, 7]);
  } else {
    // SM-2 mode: TypeScript narrows preset to Sm2Preset, making graduating/easy fields safe.
    const ints = newSec.ints as number[] | undefined;
    if (!Array.isArray(ints) || ints.length < 2) {
      failures.push(`new.ints: expected array[≥2], got ${JSON.stringify(newSec.ints)}`);
    } else {
      if (ints[0] !== preset.graduating_interval) {
        failures.push(`new.ints[0]: expected ${preset.graduating_interval} (graduating_interval), got ${ints[0]}`);
      }
      if (ints[1] !== preset.easy_interval) {
        failures.push(`new.ints[1]: expected ${preset.easy_interval} (easy_interval), got ${ints[1]}`);
      }
    }
  }
}

function assertDefaultUntouched(
  dconf: Record<string, Record<string, unknown>>,
  baseline: Record<string, unknown>,
  failures: string[],
): void {
  const actual = dconf["1"];
  if (!actual) {
    failures.push("dconf['1'] (Default) is missing after embed");
    return;
  }
  if (JSON.stringify(actual) !== JSON.stringify(baseline)) {
    failures.push("dconf['1'] (Default config) was modified — it must never be touched");
    for (const key of Object.keys(baseline)) {
      const a = JSON.stringify((actual as Record<string, unknown>)[key]);
      const e = JSON.stringify(baseline[key]);
      if (a !== e) {
        failures.push(`  dconf['1'].${key}: expected ${e}, got ${a}`);
      }
    }
  }
}

// ── Per-case runner ────────────────────────────────────────────────────────

async function runTest(
  tc: TestCase,
  baseApkg: Buffer,
  baselineDconf1: Record<string, unknown>,
  SQL: SqlJsStatic,
): Promise<TestResult> {
  const failures: string[] = [];

  let patchedApkg: Buffer;
  try {
    patchedApkg = await callEmbedPreset(baseApkg, tc.preset, `${RUN_ID}-${tc.name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`API call failed: ${msg}`);
    return { name: tc.name, desc: tc.desc, pass: false, failures };
  }

  let dconf: Record<string, Record<string, unknown>>;
  try {
    dconf = await extractDconf(patchedApkg, SQL);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`dconf extraction failed: ${msg}`);
    return { name: tc.name, desc: tc.desc, pass: false, failures };
  }

  assertPreset(dconf, tc.preset, failures);
  assertDefaultUntouched(dconf, baselineDconf1, failures);

  // Write snapshot regardless of pass/fail
  try {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SNAPSHOTS_DIR, `embed_${tc.name}.json`),
      JSON.stringify(dconf, null, 2),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`Snapshot write failed: ${msg}`);
  }

  return { name: tc.name, desc: tc.desc, pass: failures.length === 0, failures };
}

// ── Server check ───────────────────────────────────────────────────────────

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(5000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

// ── Table renderer ─────────────────────────────────────────────────────────

function renderTable(results: TestResult[]): void {
  const col = { name: 36, result: 9 };

  const header = [
    "Case".padEnd(col.name),
    "Result",
  ].join(" | ");
  const sep = header.replace(/[^|]/g, "-").replace(/\|/g, "+");

  console.log("\n" + header);
  console.log(sep);
  for (const r of results) {
    console.log(
      r.name.padEnd(col.name) +
        " | " +
        (r.pass ? "PASS" : "FAIL"),
    );
  }
  console.log(sep);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const TEST_CASES = makeTestCases();

  console.log("=".repeat(62));
  console.log("Embed-Preset Test Suite");
  console.log("=".repeat(62));
  console.log(`Total    : ${TEST_CASES.length} cases (all via POST /api/embed-preset)`);
  console.log(`FSRS-on  : ${TEST_CASES.filter(tc => tc.preset.fsrs_enabled).length}`);
  console.log(`FSRS-off : ${TEST_CASES.filter(tc => !tc.preset.fsrs_enabled).length}`);
  console.log(`Endpoint : ${BASE_URL}/api/embed-preset`);
  console.log(`Snapshots: ${SNAPSHOTS_DIR}`);
  console.log("-".repeat(62));

  const up = await isServerUp();
  if (!up) {
    console.error(
      "\n⚠  Dev server not reachable at http://localhost:3000\n" +
        "   Start it with: npm run dev\n" +
        "   Then re-run:   npm run test:embed\n",
    );
    process.exit(1);
  }
  console.log("Server: reachable ✓");

  const SQL = await initSqlJs();
  const baseApkg = await createSyntheticApkg(SQL);

  // Capture the baseline dconf["1"] once from the unpatched synthetic .apkg.
  const baseDconf = await extractDconf(baseApkg, SQL);
  const baselineDconf1 = baseDconf["1"];
  if (!baselineDconf1) {
    console.error("FATAL: synthetic .apkg missing dconf['1']");
    process.exit(1);
  }
  console.log("Synthetic .apkg: created ✓\n");

  const results: TestResult[] = [];
  let passCount = 0;

  for (const tc of TEST_CASES) {
    const modeLabel = tc.preset.fsrs_enabled ? "FSRS on " : "FSRS off";
    process.stdout.write(`  [${modeLabel}] ${tc.desc.padEnd(44)} ... `);

    const result = await runTest(tc, baseApkg, baselineDconf1, SQL);
    results.push(result);

    if (result.pass) {
      passCount++;
      console.log("PASS");
    } else {
      console.log("FAIL");
      for (const f of result.failures) {
        console.log(`           ↳ ${f}`);
      }
    }
  }

  renderTable(results);

  const total = results.length;
  console.log(
    `\nSummary: ${passCount}/${total} cases passed` +
      (passCount === total ? " ✓" : " — see failures above"),
  );
  console.log(`Snapshots written to: ${SNAPSHOTS_DIR}\n`);

  if (passCount < total) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
