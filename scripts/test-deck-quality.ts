/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Deck Quality Test Suite
 * Tests all 8 card styles × 3 densities against a fixed sample text.
 * Requires dev server on localhost:3000 (npm run dev).
 */

const JSZip = require("jszip") as typeof import("jszip");
const initSqlJs = require("sql.js") as () => Promise<SqlJsStatic>;

// ── Types ──────────────────────────────────────────────────────────────────

interface SqlResultSet {
  columns: string[];
  values: unknown[][];
}

interface SqlDatabase {
  exec(sql: string): SqlResultSet[];
  close(): void;
}

interface SqlJsStatic {
  Database: new (data: Uint8Array) => SqlDatabase;
}

interface Card {
  front: string;
  back: string;
}

interface TestResult {
  style: string;
  density: string;
  cardCount: number;
  clozOk: boolean | null;   // null = N/A for this style
  formatOk: boolean;
  visuals: string;           // "X/Y"
  citations: string;         // "--" until citation tracking is instrumented
  pass: boolean;
  failures: string[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const SAMPLE_TEXT =
  "The sodium-potassium ATPase pump moves 3 Na+ out and 2 K+ in per " +
  "cycle, consuming 1 ATP. This maintains the resting membrane potential " +
  "of approximately -70mV in neurons. Failure of this pump leads to " +
  "cellular swelling and depolarization. The pump is inhibited by " +
  "ouabain and cardiac glycosides like digoxin. Action potential " +
  "propagation velocity increases with axon diameter and myelination. " +
  "Saltatory conduction between nodes of Ranvier allows speeds up to " +
  "120 m/s in large myelinated fibers.";

const FORMULA_SAMPLE_TEXT = `The Nernst equation calculates the equilibrium potential for a single ion: E = (RT/zF) * ln([X]o/[X]i), where R is the gas constant (8.314 J/mol·K), T is temperature in Kelvin, z is the ion valence, and F is Faraday's constant (96485 C/mol). The Henderson-Hasselbalch equation describes buffer pH: pH = pKa + log([A-]/[HA]). Fick's first law of diffusion states J = -D * (dC/dx), where J is flux, D is the diffusion coefficient, and dC/dx is the concentration gradient. The Goldman equation calculates resting membrane potential accounting for multiple ions: Vm = (RT/F) * ln((PK[K]o + PNa[Na]o + PCl[Cl]i) / (PK[K]i + PNa[Na]i + PCl[Cl]o)). Ohm's law applied to neurons: I = V/R, where membrane current I equals voltage divided by resistance. Cardiac output is calculated as CO = HR * SV, where heart rate is in beats/min and stroke volume in mL/beat.`;

const SOLVE_SAMPLE_TEXT = `A patient weighing 80 kg requires a dopamine infusion at 5 mcg/kg/min. The available concentration is 400 mg in 250 mL D5W. A neuron has a resting membrane potential of -70 mV and a sodium equilibrium potential of +60 mV. The Na-K ATPase moves 3 Na+ out and 2 K+ in per cycle, consuming 1 ATP per cycle. At 37°C, the Nernst potential for K+ is calculated using R = 8.314 J/mol·K, F = 96485 C/mol, with intracellular K+ at 140 mM and extracellular K+ at 4 mM. A myelinated axon with diameter 10 micrometers conducts at 50 m/s. An unmyelinated axon of 1 micrometer conducts at 1 m/s. Membrane resistance is 10,000 ohm·cm² and membrane capacitance is 1 microfarad/cm². A synapse releases 100 vesicles per action potential, each containing 5,000 molecules of neurotransmitter. The diffusion coefficient for a small molecule in water is 10^-5 cm²/s across a membrane 5 nm thick with a concentration gradient of 1 mM/nm.`;

const STYLES = [
  "standard",
  "cloze",
  "concise",
  "essay",
  "mcq",
  "solve",
  "formula",
  "custom",
] as const;

type Style = (typeof STYLES)[number];

const DENSITIES = ["high-yield", "comprehensive", "granular"] as const;

type Density = (typeof DENSITIES)[number];

const BASE_URL = "http://localhost:3000";

// Custom prompt used when style === "custom"
const CUSTOM_PROMPT =
  "Generate standard flashcards with a clear question on the front and a " +
  "complete sentence answer on the back. No lists or bullet points.";

// ── Server check ───────────────────────────────────────────────────────────

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(5000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

// ── API call ───────────────────────────────────────────────────────────────

async function generateDeck(style: Style, density: Density, text: string = SAMPLE_TEXT): Promise<Buffer> {
  const formData = new FormData();
  formData.append("text", text);
  formData.append("style", style);
  formData.append("density", density);
  formData.append("filename", "test_sample");
  if (style === "custom") {
    formData.append("customPrompt", CUSTOM_PROMPT);
  }

  const res = await fetch(`${BASE_URL}/api/generate`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

// ── .apkg → cards ─────────────────────────────────────────────────────────

async function extractCards(apkgBuffer: Buffer): Promise<Card[]> {
  const zip = new JSZip();
  await zip.loadAsync(apkgBuffer);

  const dbFile = zip.file("collection.anki2");
  if (!dbFile) throw new Error("collection.anki2 not found in .apkg");

  const dbData: Uint8Array = await dbFile.async("uint8array");

  const SQL = await initSqlJs();
  const db = new SQL.Database(dbData);

  let rows: unknown[][];
  try {
    const results = db.exec("SELECT flds FROM notes");
    rows = results.length ? results[0].values : [];
  } finally {
    db.close();
  }

  // Anki separates fields with ASCII 0x1f (unit separator)
  return rows.map((row) => {
    const flds = row[0] as string;
    const parts = flds.split("\x1f");
    return { front: parts[0] ?? "", back: parts[1] ?? "" };
  });
}

// ── Style assertions ───────────────────────────────────────────────────────

const CLOZE_RE = /\{\{c\d+::/;
const MCQ_RE = /\bA\)|A\.\s|\(A\)/i;
const FORMULA_RE = /[=+\-×÷]|[A-Za-z]+\s*=\s*[A-Za-z]/;
const SOLVE_RE = /=\s*[\d.]+\s*[a-zA-Z]*/;

function assertStyle(
  style: Style,
  cards: Card[],
  failures: string[],
): { clozOk: boolean | null; formatOk: boolean } {
  switch (style) {
    case "cloze": {
      const ok = cards.some(
        (c) => CLOZE_RE.test(c.front) || CLOZE_RE.test(c.back) || c.front.includes("___"),
      );
      if (!ok) {
        failures.push(
          "Cloze style: no card contains {{c1:: syntax or fill-in-the-blank blanks",
        );
        const sample = cards[0];
        if (sample) failures.push(`  Sample front: "${sample.front.slice(0, 120)}"`);
      }
      return { clozOk: ok, formatOk: true };
    }

    case "mcq": {
      const ok = cards.some((c) => MCQ_RE.test(c.front));
      if (!ok) {
        failures.push("MCQ style: no card front contains A) / (A) option markers");
        const sample = cards[0];
        if (sample) failures.push(`  Sample front: "${sample.front.slice(0, 200)}"`);
      }
      return { clozOk: null, formatOk: ok };
    }

    case "formula": {
      const ok = cards.some((c) => FORMULA_RE.test(c.back));
      if (!ok) {
        failures.push("Formula style: no card back contains an equation or = sign");
        const sample = cards[0];
        if (sample) failures.push(`  Sample back: "${sample.back.slice(0, 120)}"`);
      }
      return { clozOk: null, formatOk: ok };
    }

    case "solve": {
      const ok = cards.some((c) => SOLVE_RE.test(c.back));
      if (!ok) {
        failures.push("Solve style: no card back contains a worked numerical result");
        const sample = cards[0];
        if (sample) failures.push(`  Sample back: "${sample.back.slice(0, 120)}"`);
      }
      return { clozOk: null, formatOk: ok };
    }

    case "standard":
    case "concise":
    case "essay":
    case "custom": {
      const clozeInBack = cards.filter((c) => CLOZE_RE.test(c.back));
      if (clozeInBack.length) {
        failures.push(
          `${style} style: ${clozeInBack.length} card(s) have cloze syntax in back field`,
        );
      }
      return { clozOk: null, formatOk: clozeInBack.length === 0 };
    }
  }
}

// ── Per-combination test ───────────────────────────────────────────────────

async function runTest(style: Style, density: Density): Promise<TestResult> {
  const failures: string[] = [];

  let cards: Card[];
  try {
    const sampleText = style === "formula" ? FORMULA_SAMPLE_TEXT : style === "solve" ? SOLVE_SAMPLE_TEXT : SAMPLE_TEXT;
    const apkgBuffer = await generateDeck(style, density, sampleText);
    cards = await extractCards(apkgBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`Generation/extraction error: ${msg}`);
    return {
      style,
      density,
      cardCount: 0,
      clozOk: null,
      formatOk: false,
      visuals: "0/0",
      citations: "--",
      pass: false,
      failures,
    };
  }

  // Card count
  if (cards.length === 0) {
    failures.push("No cards generated");
    return {
      style,
      density,
      cardCount: 0,
      clozOk: null,
      formatOk: false,
      visuals: "0/0",
      citations: "--",
      pass: false,
      failures,
    };
  }

  // Non-empty fronts
  const emptyFronts = cards.filter((c) => !c.front.trim());
  if (emptyFronts.length) {
    failures.push(`${emptyFronts.length} card(s) have an empty front field`);
  }

  // Non-empty backs
  const emptyBacks = cards.filter((c) => !c.back.trim());
  if (emptyBacks.length) {
    failures.push(`${emptyBacks.length} card(s) have an empty back field`);
  }

  // Back field length check — concise style legitimately produces 1-5 word answers,
  // so use a minimal non-empty threshold for it; all other styles require >10 chars.
  const minBackLen = style === "concise" ? 1 : 10;
  const shortBacks = cards.filter((c) => c.back.trim().length <= minBackLen);
  if (shortBacks.length) {
    failures.push(`${shortBacks.length} card(s) have back field ≤${minBackLen} chars (near-empty)`);
    shortBacks.slice(0, 2).forEach((c) =>
      failures.push(`  back: "${c.back}" | front: "${c.front.slice(0, 60)}"`),
    );
  }

  // Style-specific checks
  const { clozOk, formatOk } = assertStyle(style, cards, failures);

  // Visuals
  const withImages = cards.filter((c) => c.back.includes("<img")).length;
  const visuals = `${withImages}/${cards.length}`;

  // TODO: citation field is stored as separate JSON key, not in flds — needs route-level change to append to back if citation tracking is wanted
  const citations = "--";

  return {
    style,
    density,
    cardCount: cards.length,
    clozOk,
    formatOk,
    visuals,
    citations,
    pass: failures.length === 0,
    failures,
  };
}

// ── Table renderer ─────────────────────────────────────────────────────────

function renderTable(results: TestResult[]): void {
  const col = {
    style: 10,
    density: 13,
    cards: 5,
    cloze: 7,
    format: 8,
    visuals: 11,
    cites: 9,
    pass: 9,
  };

  const header = [
    "Style".padEnd(col.style),
    "Density".padEnd(col.density),
    "Cards".padEnd(col.cards),
    "Cloze✓".padEnd(col.cloze),
    "Format✓".padEnd(col.format),
    "Visuals".padEnd(col.visuals),
    "Citations".padEnd(col.cites),
    "Pass/Fail",
  ].join(" | ");

  const sep = header.replace(/[^|]/g, "-").replace(/\|/g, "+");

  console.log("\n" + header);
  console.log(sep);

  for (const r of results) {
    const clozCell =
      r.clozOk === null ? "N/A".padEnd(col.cloze) : (r.clozOk ? "✓" : "✗").padEnd(col.cloze);
    const row = [
      r.style.padEnd(col.style),
      r.density.padEnd(col.density),
      String(r.cardCount).padEnd(col.cards),
      clozCell,
      (r.formatOk ? "✓" : "✗").padEnd(col.format),
      r.visuals.padEnd(col.visuals),
      r.citations.padEnd(col.cites),
      r.pass ? "PASS" : "FAIL",
    ].join(" | ");
    console.log(row);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Anki Deck Quality Test Suite");
  console.log("=".repeat(60));
  console.log(`Styles   : ${STYLES.join(", ")}`);
  console.log(`Densities: ${DENSITIES.join(", ")}`);
  console.log(`Total    : ${STYLES.length * DENSITIES.length} combinations`);
  console.log(`Endpoint : ${BASE_URL}/api/generate`);
  console.log("-".repeat(60));

  const up = await isServerUp();
  if (!up) {
    console.error(
      "\n⚠  Dev server not reachable at http://localhost:3000\n" +
        "   Start it with: npm run dev\n" +
        "   Then re-run:  npm run test:decks\n",
    );
    process.exit(1);
  }
  console.log("Server: reachable ✓\n");

  const results: TestResult[] = [];
  let passCount = 0;

  for (const style of STYLES) {
    for (const density of DENSITIES) {
      const label = `${style.padEnd(9)} / ${density}`;
      process.stdout.write(`  Testing ${label} ... `);

      const result = await runTest(style, density);
      results.push(result);

      if (result.pass) {
        passCount++;
        console.log(`PASS  (${result.cardCount} cards, ${result.visuals} visuals)`);
      } else {
        console.log(`FAIL`);
        for (const f of result.failures) {
          console.log(`        ↳ ${f}`);
        }
      }
    }
  }

  renderTable(results);

  const total = results.length;
  console.log(
    `\nSummary: ${passCount}/${total} combinations passed` +
      (passCount === total ? " ✓" : " — see failures above"),
  );

  if (passCount < total) process.exit(1);
}

// ── Citation footer test ───────────────────────────────────────────────────

const CITATION_SAMPLE_TEXT =
  "The action potential propagates along the axon through a sequence of " +
  "voltage-gated channel events. At rest, the membrane potential is " +
  "approximately -70mV, maintained by the Na⁺/K⁺ ATPase pumping 3 Na⁺ out " +
  "and 2 K⁺ in per ATP hydrolyzed. Depolarization occurs when voltage-gated " +
  "Na⁺ channels open, allowing rapid Na⁺ influx and driving the membrane " +
  "toward +40mV. This triggers inactivation of Na⁺ channels and opening of " +
  "voltage-gated K⁺ channels, causing K⁺ efflux and repolarization. The " +
  "brief hyperpolarization below -70mV — the absolute refractory period — " +
  "occurs because K⁺ channels close slowly. Myelination by oligodendrocytes " +
  "in the CNS (Schwann cells in the PNS) forces saltatory conduction at the " +
  "nodes of Ranvier, increasing conduction velocity dramatically compared to " +
  "unmyelinated fibers.";

interface CitationResult {
  density: string;
  cardCount: number;
  citationOk: string;
  flagOk: string;
  pass: boolean;
}

async function generatePasteDeck(density: Density): Promise<Buffer> {
  const formData = new FormData();
  formData.append("text", CITATION_SAMPLE_TEXT);
  formData.append("style", "standard");
  formData.append("density", density);
  // no filename — triggers paste mode (isPaste = true) in the route

  const res = await fetch(`${BASE_URL}/api/generate`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function runCitationTest(density: Density): Promise<CitationResult> {
  let cards: Card[];
  try {
    cards = await extractCards(await generatePasteDeck(density));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`FAIL: ${msg}`);
    return { density, cardCount: 0, citationOk: "0/0", flagOk: "0/0", pass: false };
  }

  const n = cards.length;
  let citationCount = 0;
  let flagCount = 0;

  for (const card of cards) {
    if (card.back.includes("tally.so")) citationCount++;
    else console.log(`    ↳ Missing tally.so on: "${card.front.slice(0, 80)}"`);
    if (card.back.includes("⚑ flag")) flagCount++;
  }

  return {
    density,
    cardCount: n,
    citationOk: `${citationCount}/${n}`,
    flagOk: `${flagCount}/${n}`,
    pass: citationCount === n && flagCount === n,
  };
}

function renderCitationTable(results: CitationResult[]): void {
  const bar = "─".repeat(57);
  console.log("\nCITATION FOOTER TEST");
  console.log(bar);
  console.log(
    "Density".padEnd(15) +
      "Cards".padEnd(8) +
      "Citation✓".padEnd(12) +
      "Flag✓".padEnd(8) +
      "Result",
  );
  console.log(bar);
  for (const r of results) {
    console.log(
      r.density.padEnd(15) +
        String(r.cardCount).padEnd(8) +
        r.citationOk.padEnd(12) +
        r.flagOk.padEnd(8) +
        (r.pass ? "PASS" : "FAIL"),
    );
  }
  console.log(bar);
  const passing = results.filter((r) => r.pass).length;
  console.log(`${passing}/${results.length} PASS`);
}

async function citationMain(): Promise<void> {
  console.log("=".repeat(57));
  console.log("Citation Footer Test Suite");
  console.log("=".repeat(57));
  console.log(`Endpoint: ${BASE_URL}/api/generate`);
  console.log("-".repeat(57));

  const up = await isServerUp();
  if (!up) {
    console.error(
      "\n⚠  Dev server not reachable at http://localhost:3000\n" +
        "   Start it with: npm run dev\n" +
        "   Then re-run:  npm run test:citations\n",
    );
    process.exit(1);
  }
  console.log("Server: reachable ✓\n");

  const results: CitationResult[] = [];
  for (const density of DENSITIES) {
    process.stdout.write(`  Testing standard / ${density} ... `);
    const result = await runCitationTest(density);
    results.push(result);
    console.log(result.pass ? `PASS  (${result.cardCount} cards)` : "FAIL");
  }

  renderCitationTable(results);

  if (results.some((r) => !r.pass)) process.exit(1);
}

// ── Entry point ────────────────────────────────────────────────────────────

if (process.argv.includes("--citations-only")) {
  citationMain().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
