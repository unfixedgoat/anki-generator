/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Generator E2E Test Suite
 *
 * Verifies /api/generate across 8 styles × 3 densities × 2 source modes = 48 runs.
 * Each run: POST FormData → receive .apkg → unzip → open SQLite → assert deck shape.
 *
 * Requires dev server on localhost:3000 (npm run dev).
 */

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

// Load .env.local before anything that reads env vars
const envFile = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq);
    const v = t.slice(eq + 1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const JSZip = require("jszip") as typeof import("jszip");
const initSqlJs = require("sql.js") as () => Promise<SqlJsStatic>;

// ── Types ─────────────────────────────────────────────────────────────────

interface SqlResultSet { columns: string[]; values: unknown[][] }
interface SqlDatabase {
  exec(sql: string): SqlResultSet[];
  close(): void;
}
interface SqlJsStatic { Database: new (data?: Uint8Array) => SqlDatabase }

type Style   = "standard" | "cloze" | "concise" | "essay" | "mcq" | "solve" | "formula" | "custom";
type Density = "high-yield" | "comprehensive" | "granular";
type Mode    = "pdf" | "paste";

interface TestCase   { style: Style; density: Density; mode: Mode }
interface TestResult { style: Style; density: Density; mode: Mode; cards: number; citations: number; visuals: number; pass: boolean; failures: string[] }

// ── Constants ─────────────────────────────────────────────────────────────

const BASE_URL     = "http://localhost:3000";
const SNAPSHOTS_DIR = path.join(__dirname, "_snapshots");
const AUDIT_DIR    = path.join(__dirname, "../_audit");
const BYPASS_TOKEN = process.env.TEST_BYPASS_TOKEN ?? "";

// Prompt for the "custom" style slot
const CUSTOM_PROMPT =
  "Generate question-answer pairs focused on key terms and their definitions. " +
  "Front: the term or concept. Back: a concise, complete definition or explanation.";

// Sample text: physiology + equations + numbers — covers all 8 style types
const SAMPLE_TEXT =
  "The sodium-potassium ATPase pump moves 3 Na⁺ out and 2 K⁺ in per cycle, consuming 1 ATP. " +
  "The stoichiometry (3:2:1) maintains the resting membrane potential of −70 mV in neurons. " +
  "The Nernst equation calculates ion equilibrium potential: E = (RT/zF) × ln([X]o/[X]i), " +
  "where R = 8.314 J/mol·K, T is temperature in Kelvin, z is ion valence, F = 96,485 C/mol. " +
  "At rest: [K⁺]i = 140 mM, [K⁺]o = 5 mM, [Na⁺]i = 12 mM, [Na⁺]o = 145 mM. " +
  "The Goldman equation for steady-state membrane potential: " +
  "Vm = (RT/F) × ln((PK[K⁺]o + PNa[Na⁺]o) / (PK[K⁺]i + PNa[Na⁺]i)). " +
  "The membrane time constant τ = RC; with R = 10⁷ Ω and C = 10⁻⁸ F, τ = 100 ms. " +
  "Action potential conduction velocity increases with axon diameter and myelination. " +
  "Saltatory conduction between nodes of Ranvier reaches 120 m/s in large myelinated fibers. " +
  "The cardiac action potential has five phases: 0 (rapid Na⁺ depolarization), 1 (transient K⁺), " +
  "2 (Ca²⁺ plateau), 3 (K⁺ repolarization), 4 (resting). Normal QT interval is 350–440 ms. " +
  "Drug elimination follows first-order kinetics: C(t) = C₀ × e^(−kt), half-life t½ = 0.693/k. " +
  "A drug with k = 0.1 h⁻¹ has t½ = 6.93 hours. Volume of distribution: Vd = Dose / C₀. " +
  "Renal clearance: CLrenal = GFR × fu − Treabsorption + Tsecretion; normal GFR ≈ 120 mL/min. " +
  "Henderson-Hasselbalch equation: pH = pKa + log([A⁻]/[HA]). " +
  "At physiologic pH 7.4, a weak acid with pKa 6.4 has [A⁻]/[HA] = 10. " +
  "Cardiac output CO = HR × SV. Normal CO ≈ 5 L/min (HR = 70 bpm, SV = 70 mL). " +
  "Mean arterial pressure MAP = DBP + (1/3)(PP), where PP = SBP − DBP. " +
  "Poiseuille's law: Q = πr⁴ΔP / 8ηL — resistance ∝ 1/r⁴. " +
  "Fick's law of diffusion: J = −D × A × (ΔC/Δx). " +
  "Myosin ATPase hydrolyzes ATP during the cross-bridge cycle. The power stroke occurs after " +
  "Pi release, generating ≈ 3–4 pN of force per head. Troponin C binds Ca²⁺ to initiate contraction. " +
  "Inhibition of carbonic anhydrase (e.g., acetazolamide) reduces HCO₃⁻ reabsorption in the PCT.";

// ── Test matrix ───────────────────────────────────────────────────────────

const STYLES:    Style[]   = ["standard", "cloze", "concise", "essay", "mcq", "solve", "formula", "custom"];
const DENSITIES: Density[] = ["high-yield", "comprehensive", "granular"];
const MODES:     Mode[]    = ["pdf", "paste"];

function makeTestCases(): TestCase[] {
  const cases: TestCase[] = [];
  for (const style of STYLES) for (const density of DENSITIES) for (const mode of MODES)
    cases.push({ style, density, mode });
  return cases; // 8 × 3 × 2 = 48
}

// ── API call ──────────────────────────────────────────────────────────────

// Backoff schedule for 502 retries (ms). Three attempts gives 10+20+40 = 70 s
// total wait — enough to outlast a 60 s Gemini rate-limit window.
const RETRY_DELAYS = [10_000, 20_000, 40_000];

async function callGenerate(tc: TestCase, attempt = 0): Promise<Response> {
  const fd = new FormData();
  fd.append("text", SAMPLE_TEXT);
  fd.append("density", tc.density);
  fd.append("style", tc.style);
  if (tc.style === "custom") fd.append("customPrompt", CUSTOM_PROMPT);
  if (tc.mode === "pdf")     fd.append("filename", "test_document.pdf");

  const res = await fetch(`${BASE_URL}/api/generate`, {
    method: "POST",
    body: fd,
    headers: {
      "x-forwarded-for": `e2e-${tc.style}-${tc.density}-${tc.mode}`,
      ...(BYPASS_TOKEN ? { "x-test-token": BYPASS_TOKEN } : {}),
    },
    signal: AbortSignal.timeout(180_000),
  });

  // Retry on transient Gemini errors (502) with exponential backoff
  if (res.status === 502 && attempt < RETRY_DELAYS.length) {
    const delay = RETRY_DELAYS[attempt];
    process.stdout.write(` [502, retry ${attempt + 1} in ${delay / 1000}s]`);
    await new Promise(r => setTimeout(r, delay));
    return callGenerate(tc, attempt + 1);
  }

  return res;
}

// ── Per-run test logic ────────────────────────────────────────────────────

async function runTest(tc: TestCase, SQL: SqlJsStatic): Promise<TestResult> {
  const failures: string[] = [];
  let cards = 0, citations = 0, visuals = 0;

  // 1. Make the API call
  let res: Response;
  try {
    res = await callGenerate(tc);
  } catch (err) {
    failures.push(`API call failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ...tc, cards, citations, visuals, pass: false, failures };
  }

  // 2. Assert status 200
  if (res.status !== 200) {
    const body = await res.text().catch(() => "");
    failures.push(`HTTP ${res.status} — ${body.slice(0, 200)}`);
    return { ...tc, cards, citations, visuals, pass: false, failures };
  }

  // 3. Assert Content-Disposition header
  const cd = res.headers.get("content-disposition") ?? "";
  if (!cd.includes("attachment; filename=")) {
    failures.push(`Content-Disposition missing 'attachment; filename=' — got: "${cd}"`);
  } else if (!cd.includes(".apkg")) {
    failures.push(`Content-Disposition filename does not end in .apkg — got: "${cd}"`);
  }

  // 4. Read binary body
  let apkgBytes: ArrayBuffer;
  try {
    apkgBytes = await res.arrayBuffer();
  } catch (err) {
    failures.push(`Body read failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ...tc, cards, citations, visuals, pass: false, failures };
  }

  // 5. Unzip — Session 10 regression guard: must have collection.anki2, NOT anki21b
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await new JSZip().loadAsync(apkgBytes);
  } catch (err) {
    failures.push(`Unzip failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ...tc, cards, citations, visuals, pass: false, failures };
  }

  if (zip.file("collection.anki21b")) {
    failures.push("collection.anki21b found — must use collection.anki2 only (Session 10 regression guard)");
  }
  const anki2File = zip.file("collection.anki2");
  if (!anki2File) {
    failures.push("collection.anki2 not found in zip");
    return { ...tc, cards, citations, visuals, pass: false, failures };
  }

  // 6. Open SQLite
  let db: InstanceType<SqlJsStatic["Database"]>;
  try {
    const dbBytes = await anki2File.async("uint8array");
    db = new SQL.Database(dbBytes);
  } catch (err) {
    failures.push(`sql.js open failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ...tc, cards, citations, visuals, pass: false, failures };
  }

  try {
    // 7. notes count > 0
    const noteRows = db.exec("SELECT COUNT(*) FROM notes");
    const noteCount = Number(noteRows[0]?.values[0]?.[0] ?? 0);
    if (noteCount === 0) failures.push("notes table has 0 rows");
    cards = noteCount;

    // 8. cards count > 0
    const cardRows = db.exec("SELECT COUNT(*) FROM cards");
    const cardCount = Number(cardRows[0]?.values[0]?.[0] ?? 0);
    if (cardCount === 0) failures.push("cards table has 0 rows");

    // 9. Non-default deck exists in col.decks
    const colRows = db.exec("SELECT decks, dconf FROM col WHERE id=1");
    const decksJson = colRows[0]?.values[0]?.[0] as string ?? "{}";
    const dconfJson = colRows[0]?.values[0]?.[1] as string ?? "{}";
    const decks = JSON.parse(decksJson) as Record<string, Record<string, unknown>>;
    const dconf  = JSON.parse(dconfJson) as Record<string, Record<string, unknown>>;

    const nonDefault = Object.values(decks).filter(
      d => Number(d.id) !== 1 && d.name !== "Default" && d.name !== "Template",
    );
    if (nonDefault.length === 0) {
      failures.push("No non-default deck found in col.decks JSON");
    }

    // 10–12. Per-note field validation
    const fldsRows = db.exec("SELECT flds FROM notes");
    const allFlds: string[] = fldsRows[0]?.values.map(r => r[0] as string) ?? [];

    let hasCloePattern  = false; // for style assertion
    let hasMcqPattern   = false;
    let hasFormulaEqual = false;

    for (const flds of allFlds) {
      const parts = flds.split("\x1f");
      const front = parts[0] ?? "";
      const back  = parts[1] ?? "";

      if (!front.trim()) failures.push(`Empty front field (flds[:60]: ${flds.slice(0, 60)})`);
      if (!back.trim())  failures.push(`Empty back field (front[:50]: ${front.slice(0, 50)})`);

      // Back must not contain Anki cloze markers ({{cN::)
      if (/\{\{c\d+::/.test(back)) {
        failures.push(`back contains cloze marker {{cN:: — (front: ${front.slice(0, 50)})`);
      }
      // Back must not contain literal JS error strings
      if (back.includes("undefined")) {
        failures.push(`back contains 'undefined' — (front: ${front.slice(0, 50)})`);
      }
      // "null" only flag if it's isolated (not part of legitimate terms)
      if (/(?<![a-zA-Z])null(?![a-zA-Z-])/.test(back) &&
          !back.includes("null hypothesis") &&
          !back.includes("null mutation")   &&
          !back.includes("null allele")) {
        failures.push(`back contains isolated 'null' — (front: ${front.slice(0, 50)})`);
      }

      // Count images (informational, step 15)
      visuals += (flds.match(/<img/g) ?? []).length;

      // Style pattern tracking
      if (front.includes("___"))  hasCloePattern  = true;
      if (flds.includes("A)"))    hasMcqPattern   = true;
      if (back.includes("="))     hasFormulaEqual = true;

      // 11. PDF mode: citation footer markup must be present
      // The footer always includes this CSS border regardless of whether citation text is shown
      if (tc.mode === "pdf") {
        if (!back.includes("border-top:1px solid #f0f0f0")) {
          failures.push(`[pdf] back missing footer markup (front: ${front.slice(0, 50)})`);
        }
        // Count backs that show the space-between citation reference (actual source cited)
        if (back.includes("justify-content:space-between")) citations++;
      }

      // 12. Paste mode: flag link present; no source-reference citation
      if (tc.mode === "paste") {
        if (!back.includes("tally.so")) {
          failures.push(`[paste] back missing flag link (front: ${front.slice(0, 50)})`);
        }
        if (back.includes("justify-content:space-between")) {
          failures.push(`[paste] back has citation source-reference — should be flag-only (front: ${front.slice(0, 50)})`);
        }
      }
    }

    // 13. Style-specific assertions
    if (tc.style === "cloze" && allFlds.length > 0 && !hasCloePattern) {
      failures.push("cloze style: no front field contains ___ fill-in-the-blank pattern");
    }
    if (tc.style === "mcq" && allFlds.length > 0 && !hasMcqPattern) {
      failures.push("mcq style: no note flds contains 'A)' MCQ option");
    }
    if (tc.style === "formula" && allFlds.length > 0 && !hasFormulaEqual) {
      failures.push("formula style: no back field contains '=' (equation)");
    }

    // 14. FSRS dconf regression guard: any FSRS-enabled config must have new.ints = [1,4,7]
    for (const [cfgId, cfg] of Object.entries(dconf)) {
      const newSec = cfg.new as Record<string, unknown> | undefined;
      if (!newSec) continue;
      // Only assert on entries that carry FSRS-specific keys
      if (cfg.desiredRetention !== undefined || cfg.weights !== undefined || cfg.fsrsWeights !== undefined) {
        if (JSON.stringify(newSec.ints) !== JSON.stringify([1, 4, 7])) {
          failures.push(
            `dconf[${cfgId}] FSRS config has new.ints = ${JSON.stringify(newSec.ints)}, expected [1,4,7]`,
          );
        }
      }
    }

  } finally {
    db.close();
  }

  // Write snapshot
  const snapshotPath = path.join(SNAPSHOTS_DIR, `generator_e2e_${tc.style}_${tc.density}_${tc.mode}.json`);
  try {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify({ style: tc.style, density: tc.density, mode: tc.mode, cards, citations, visuals, failures }, null, 2));
  } catch { /* non-fatal */ }

  return { ...tc, cards, citations, visuals, pass: failures.length === 0, failures };
}

// ── Table renderer ────────────────────────────────────────────────────────

function renderTable(results: TestResult[]): void {
  const W = { style: 10, density: 15, mode: 6, cards: 7, cit: 10, vis: 8, res: 6 };
  const header =
    "Style".padEnd(W.style)     + " | " +
    "Density".padEnd(W.density)  + " | " +
    "Mode".padEnd(W.mode)        + " | " +
    "Cards".padEnd(W.cards)      + " | " +
    "Citations".padEnd(W.cit)    + " | " +
    "Visuals".padEnd(W.vis)      + " | " +
    "Result";
  const sep = "-".repeat(header.length);

  console.log("\n" + header);
  console.log(sep);
  for (const r of results) {
    console.log(
      r.style.padEnd(W.style)                       + " | " +
      r.density.padEnd(W.density)                   + " | " +
      r.mode.padEnd(W.mode)                         + " | " +
      String(r.cards).padEnd(W.cards)               + " | " +
      String(r.citations).padEnd(W.cit)             + " | " +
      String(r.visuals).padEnd(W.vis)               + " | " +
      (r.pass ? "PASS" : "FAIL"),
    );
  }
  console.log(sep);
}

// ── Server check ──────────────────────────────────────────────────────────

async function isServerUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(5_000) });
    return r.status < 500;
  } catch { return false; }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cases = makeTestCases();

  console.log("=".repeat(72));
  console.log("Generator E2E Test Suite");
  console.log("=".repeat(72));
  console.log(`Total    : ${cases.length} runs  (8 styles × 3 densities × 2 modes)`);
  console.log(`Endpoint : ${BASE_URL}/api/generate`);
  console.log(`Bypass   : ${BYPASS_TOKEN ? "yes (TEST_BYPASS_TOKEN set)" : "no — rate limiting active"}`);
  console.log(`Snapshots: ${SNAPSHOTS_DIR}`);
  console.log("-".repeat(72));

  if (!(await isServerUp())) {
    console.error("\nWARNING: Dev server not reachable at http://localhost:3000\nStart with: npm run dev\n");
    process.exit(1);
  }
  console.log("Server: reachable ✓\n");

  const SQL = await initSqlJs();

  // Pace calls at ~3 s apart so 48 sequential Gemini requests don't saturate
  // the per-minute rate-limit window mid-suite.
  const INTER_CALL_DELAY_MS = 3_000;

  const results: TestResult[] = [];
  let passCount = 0;

  for (let i = 0; i < cases.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, INTER_CALL_DELAY_MS));

    const tc = cases[i];
    const tag = `[${String(i + 1).padStart(2, "0")}/${cases.length}]`;
    process.stdout.write(`  ${tag} ${tc.style.padEnd(8)} ${tc.density.padEnd(15)} ${tc.mode.padEnd(5)} ... `);

    const result = await runTest(tc, SQL);
    results.push(result);

    if (result.pass) {
      passCount++;
      console.log(`PASS  (${result.cards} cards, ${result.visuals} imgs)`);
    } else {
      console.log("FAIL");
      for (const f of result.failures) console.log(`           ↳ ${f}`);
    }
  }

  renderTable(results);

  const failed = results.filter(r => !r.pass);
  console.log(
    `\nSummary: ${passCount}/${results.length} passed` +
      (passCount === results.length ? " ✓" : ` — ${failed.length} failed`),
  );

  if (failed.length > 0) {
    try {
      fs.mkdirSync(AUDIT_DIR, { recursive: true });
      const logPath = path.join(AUDIT_DIR, "e2e_failures.log");
      const lines: string[] = [
        `E2E failure log — ${new Date().toISOString()}`,
        `${failed.length} / ${results.length} tests failed`,
        "",
      ];
      for (const r of failed) {
        lines.push(`── ${r.style} / ${r.density} / ${r.mode} ──`);
        for (const f of r.failures) lines.push(`  • ${f}`);
        lines.push("");
      }
      fs.writeFileSync(logPath, lines.join("\n"));
      console.log(`\nFailure details → ${logPath}`);
    } catch { /* non-fatal */ }
    process.exit(1);
  }

  console.log(`Snapshots → ${SNAPSHOTS_DIR}\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
