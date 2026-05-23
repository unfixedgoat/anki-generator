/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Harsh-Critique Defense Test Suite
 * Defensive tests verifying the specific failure modes the r/Anki commenter alleged
 * are structurally impossible in the current build.
 *
 * No dev server required.  Attack 6 makes one live HTTPS fetch.
 *
 * Note: the task spec calls the function "buildPreset" — the actual export is
 * computePreset.  The fsrsStates matrix dimension passes fsrs_enabled to computePreset,
 * producing genuinely different AnkiPreset variants (FsrsOnPreset vs Sm2Preset).
 */

const { computePreset } = require("../app/lib/settingsRecommender") as typeof import("../app/lib/settingsRecommender");

// ── Types ──────────────────────────────────────────────────────────────────

type GoalProfile      = import("../app/lib/settingsRecommender").GoalProfile;
type DifficultyAssessment = import("../app/lib/settingsRecommender").DifficultyAssessment;
type AnkiPreset       = import("../app/lib/settingsRecommender").AnkiPreset;

interface FailureDetail {
  input:     string;
  assertion: string;
}

interface AttackResult {
  label:    string;
  casesRun: number;
  passed:   number;
  failed:   number;
  failures: FailureDetail[];
}

// ── Matrix definitions ─────────────────────────────────────────────────────

const GOALS_UI = ["cram", "balanced", "ace-keep", "long-term"] as const;
type GoalUI = (typeof GOALS_UI)[number];

// UI names used in the prompt → internal GoalProfile values
const GOAL_MAP: Record<GoalUI, GoalProfile> = {
  "cram":      "cram",
  "balanced":  "balanced",
  "ace-keep":  "exam_then_retain",
  "long-term": "long_term",
};

const DIFFICULTIES: DifficultyAssessment[] = ["easy", "medium", "hard"];
const CARD_COUNTS    = [50, 200, 500, 1000, 2000];
const DAYS_OPTIONS: (number | null)[] = [null, 7, 14, 30, 90];
const FSRS_STATES    = [true, false];

interface MatrixEntry {
  goalUI:     GoalUI;
  goal:       GoalProfile;
  difficulty: DifficultyAssessment;
  cardCount:  number;
  days:       number | null;
  fsrs:       boolean;
}

function buildMatrix(): MatrixEntry[] {
  const entries: MatrixEntry[] = [];
  for (const goalUI of GOALS_UI)
    for (const difficulty of DIFFICULTIES)
      for (const cardCount of CARD_COUNTS)
        for (const days of DAYS_OPTIONS)
          for (const fsrs of FSRS_STATES)
            entries.push({ goalUI, goal: GOAL_MAP[goalUI], difficulty, cardCount, days, fsrs });
  return entries;
}

function labelEntry(e: MatrixEntry): string {
  return `goal=${e.goalUI} diff=${e.difficulty} cards=${e.cardCount} days=${e.days ?? "null"} fsrs=${e.fsrs}`;
}

function callPreset(e: Pick<MatrixEntry, "goal" | "difficulty" | "cardCount" | "days" | "fsrs">): AnkiPreset {
  return computePreset({
    deck_sizes:                 [e.cardCount],
    days_until_exam:            e.days,
    goal:                       e.goal,
    difficulty_self_assessment: e.difficulty,
    fsrs_enabled:               e.fsrs,
  });
}

// ── Shared helpers ─────────────────────────────────────────────────────────

// Matches the route's parseStepsToMinutes — Anki stores delays in minutes.
function parseStepsToMinutes(steps: string): number[] {
  return steps.split(/\s+/).filter(Boolean).map((tok) => {
    if (tok.endsWith("m")) return parseFloat(tok);
    if (tok.endsWith("h")) return parseFloat(tok) * 60;
    if (tok.endsWith("s")) return parseFloat(tok) / 60;
    if (tok.endsWith("d")) return parseFloat(tok) * 1440;
    return parseFloat(tok);
  });
}

// Returns a list of range-sanity violations for a single preset.
// Cram mode deliberately sets leech_threshold=99 (disabled) — that value is
// expected and must not be flagged as out-of-range.
function rangeViolationsFor(preset: AnkiPreset, entry: Pick<MatrixEntry, "goal" | "days">): string[] {
  const v: string[] = [];

  if (preset.desired_retention < 0.70 || preset.desired_retention > 0.97)
    v.push(`desired_retention=${preset.desired_retention} outside [0.70, 0.97]`);

  for (const [field, steps] of [["learning_steps", preset.learning_steps], ["relearning_steps", preset.relearning_steps]] as const) {
    const mins = parseStepsToMinutes(steps);
    const bad  = mins.filter(m => m >= 1440);
    if (bad.length) v.push(`${field} contains step ≥ 1440 min (1 day): ${bad.join(", ")}`);
  }

  if (preset.new_cards_per_day < 1)
    v.push(`new_cards_per_day=${preset.new_cards_per_day} < 1`);

  if (preset.maximum_reviews_per_day < preset.new_cards_per_day)
    v.push(`maximum_reviews_per_day=${preset.maximum_reviews_per_day} < new_cards_per_day=${preset.new_cards_per_day}`);

  const isCram = entry.goal === "cram" || (entry.days !== null && entry.days <= 7);
  if (isCram) {
    if (preset.leech_threshold !== 99)
      v.push(`leech_threshold=${preset.leech_threshold} in cram mode (expected 99 — effectively disabled)`);
  } else {
    if (preset.leech_threshold < 4 || preset.leech_threshold > 12)
      v.push(`leech_threshold=${preset.leech_threshold} outside [4, 12]`);
  }

  return v;
}

// ── Attack 1 — SM-2 contamination ─────────────────────────────────────────

// Keys the harsh commenter claimed contaminate an FSRS-first output with SM-2 logic.
// After the discriminated union refactor, FsrsOnPreset intentionally omits
// graduating_interval and easy_interval — Attack 1 must report zero violations.
const SM2_KEYS = [
  "graduating_interval",
  "easy_interval",
  "easy_bonus",
  "starting_ease",
  "interval_modifier",
  "hard_interval",
  "new_interval",
  "sm2_retention",
];

function runAttack1(matrix: MatrixEntry[]): AttackResult {
  const fsrsCases = matrix.filter(e => e.fsrs);
  let passed = 0, failed = 0;
  const failures: FailureDetail[] = [];
  // Structural violations are identical for every combination — deduplicate them.
  const seenViolations = new Set<string>();

  for (const entry of fsrsCases) {
    const preset  = callPreset(entry);
    const keys    = new Set(Object.keys(preset));
    const present = SM2_KEYS.filter(k => keys.has(k));

    if (present.length === 0) {
      passed++;
    } else {
      failed++;
      for (const k of present) {
        if (!seenViolations.has(k)) {
          seenViolations.add(k);
          failures.push({
            input:     `(structural — every output, e.g. ${labelEntry(entry)})`,
            assertion: `key "${k}" present in output`,
          });
        }
      }
    }
  }

  return { label: "1 – SM-2 contamination", casesRun: fsrsCases.length, passed, failed, failures };
}

// ── Attack 2 — Workload projection elimination ─────────────────────────────

const WORKLOAD_KEYS = [
  "estimated_daily_reviews",
  "estimated_daily_minutes",
  "reviews_per_day",
  "minutes_per_day",
  "daily_workload",
  "budget_exceeded",
];

function runAttack2(matrix: MatrixEntry[]): AttackResult {
  let passed = 0, failed = 0;
  const failures: FailureDetail[] = [];
  const seenViolations = new Set<string>();

  for (const entry of matrix) {
    const preset = callPreset(entry);
    const keys   = new Set(Object.keys(preset));
    const present = WORKLOAD_KEYS.filter(k => keys.has(k));

    if (present.length === 0) {
      passed++;
    } else {
      failed++;
      for (const k of present) {
        if (!seenViolations.has(k)) {
          seenViolations.add(k);
          failures.push({ input: labelEntry(entry), assertion: `forbidden workload key "${k}" present` });
        }
      }
    }
  }

  return { label: "2 – Workload projections", casesRun: matrix.length, passed, failed, failures };
}

// ── Attack 3 — Reproduce attack inputs ────────────────────────────────────

interface Attack3Spec {
  desc:       string;
  cardCount:  number;
  days:       number | null;
  goalUI:     GoalUI;
  difficulty: DifficultyAssessment;
}

const ATTACK3_CASES: Attack3Spec[] = [
  { desc: "500 cards / 14d / ace-keep / hard",  cardCount: 500,  days: 14, goalUI: "ace-keep",  difficulty: "hard" },
  { desc: "1000 cards / 7d / ace-keep / hard",  cardCount: 1000, days: 7,  goalUI: "ace-keep",  difficulty: "hard" },
  { desc: "500 cards / 30d / long-term / hard", cardCount: 500,  days: 30, goalUI: "long-term", difficulty: "hard" },
  { desc: "2000 cards / 30d / ace-keep / hard", cardCount: 2000, days: 30, goalUI: "ace-keep",  difficulty: "hard" },
];

function runAttack3(): AttackResult {
  let passed = 0;
  const failures: FailureDetail[] = [];

  console.log("\n── Attack 3 · Reproduce Attack Inputs ─────────────────────────────\n");

  for (const tc of ATTACK3_CASES) {
    const entry = { goal: GOAL_MAP[tc.goalUI], difficulty: tc.difficulty, cardCount: tc.cardCount, days: tc.days, fsrs: true as const };
    const preset = callPreset(entry);

    const sm2Present      = SM2_KEYS.filter(k => (Object.keys(preset) as string[]).includes(k));
    const workloadPresent = WORKLOAD_KEYS.filter(k => (Object.keys(preset) as string[]).includes(k));
    const rangeViol       = rangeViolationsFor(preset, entry);
    const allViol = [
      ...sm2Present.map(k => `SM-2 key present: "${k}"`),
      ...workloadPresent.map(k => `workload key present: "${k}"`),
      ...rangeViol,
    ];

    // Full visual dump (for inspection); graduating/easy_interval only on Sm2Preset
    const dump = {
      desired_retention:         preset.desired_retention,
      new_cards_per_day:         preset.new_cards_per_day,
      maximum_reviews_per_day:   preset.maximum_reviews_per_day,
      learning_steps:            preset.learning_steps,
      relearning_steps:          preset.relearning_steps,
      leech_threshold:           preset.leech_threshold,
      leech_action:              preset.leech_action,
      maximum_interval:          preset.maximum_interval,
      insertion_order:           preset.insertion_order,
      graduating_interval:       preset.fsrs_enabled ? "N/A (FSRS)" : preset.graduating_interval,
      easy_interval:             preset.fsrs_enabled ? "N/A (FSRS)" : preset.easy_interval,
      estimated_daily_new_cards: preset.estimated_daily_new_cards,
      estimated_finish_date:     preset.estimated_finish_date,
      fsrs_enabled:              preset.fsrs_enabled,
      warnings:                  preset.warnings.map(w => `[${w.severity}] ${w.code}: ${w.message.slice(0, 80)}`),
      all_keys:                  Object.keys(preset).sort().join(", "),
    };
    console.log(`  ${tc.desc}`);
    console.log(
      JSON.stringify(dump, null, 2)
        .split("\n")
        .map(l => "    " + l)
        .join("\n"),
    );

    if (allViol.length === 0) {
      passed++;
      console.log("  → PASS\n");
    } else {
      for (const v of allViol) {
        failures.push({ input: tc.desc, assertion: v });
        console.log(`  → FAIL: ${v}`);
      }
      console.log();
    }
  }

  return {
    label:    "3 – Attack reproduction",
    casesRun: ATTACK3_CASES.length,
    passed,
    failed:   ATTACK3_CASES.length - passed,
    failures,
  };
}

// ── Attack 4 — Determinism ─────────────────────────────────────────────────

// Three diverse inputs, 5 calls each.  All calls are synchronous so estimated_finish_date
// (which reads new Date()) will be identical within a run unless it crosses midnight.
const DETERMINISM_INPUTS: Array<Pick<MatrixEntry, "goal" | "difficulty" | "cardCount" | "days" | "fsrs">> = [
  { goal: "balanced",        difficulty: "medium", cardCount: 500,  days: 30,   fsrs: true },
  { goal: "exam_then_retain",difficulty: "hard",   cardCount: 2000, days: 90,   fsrs: true },
  { goal: "long_term",       difficulty: "easy",   cardCount: 50,   days: null, fsrs: true },
];

function runAttack4(): AttackResult {
  let passed = 0, failed = 0;
  const failures: FailureDetail[] = [];

  for (const input of DETERMINISM_INPUTS) {
    const outputs = Array.from({ length: 5 }, () => JSON.stringify(callPreset(input)));
    const allSame = outputs.every(o => o === outputs[0]);
    if (allSame) {
      passed++;
    } else {
      failed++;
      const idx = outputs.findIndex((o, i) => i > 0 && o !== outputs[0]);
      failures.push({
        input:     `goal=${input.goal} diff=${input.difficulty} cards=${input.cardCount} days=${input.days ?? "null"}`,
        assertion: `call #${idx + 1} produced different JSON.stringify output`,
      });
    }
  }

  return { label: "4 – Determinism", casesRun: DETERMINISM_INPUTS.length, passed, failed, failures };
}

// ── Attack 5 — Range sanity ────────────────────────────────────────────────

function runAttack5(matrix: MatrixEntry[]): AttackResult {
  let passed = 0, failed = 0;
  const failures: FailureDetail[] = [];

  for (const entry of matrix) {
    const preset = callPreset(entry);
    const viol   = rangeViolationsFor(preset, entry);

    if (viol.length === 0) {
      passed++;
    } else {
      failed++;
      if (failures.length < 10) {
        for (const v of viol)
          failures.push({ input: labelEntry(entry), assertion: v });
      } else if (failures.length === 10) {
        failures.push({ input: "...", assertion: `(output truncated after 10 — ${failed} total cases failing)` });
      }
    }
  }

  return { label: "5 – Range sanity", casesRun: matrix.length, passed, failed, failures };
}

// ── Attack 6 — Caveat presence ─────────────────────────────────────────────

const ATTACK6_URL          = "https://www.highyield.cards";
const MUST_CONTAIN         = "1,000 reviews";
const MUST_NOT_CONTAIN     = ["reviews per day", "minutes per day", "estimated daily"];

async function runAttack6(): Promise<AttackResult> {
  let passed = 0, failed = 0;
  const failures: FailureDetail[] = [];
  const total = 1 + MUST_NOT_CONTAIN.length; // 4 assertions

  let body: string;
  try {
    const res = await fetch(ATTACK6_URL, { signal: AbortSignal.timeout(20_000) });
    body = await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      label: "6 – Caveat presence",
      casesRun: total,
      passed: 0,
      failed: total,
      failures: [{ input: ATTACK6_URL, assertion: `fetch failed: ${msg}` }],
    };
  }

  const lc = body.toLowerCase();

  if (body.includes(MUST_CONTAIN)) {
    passed++;
  } else {
    failed++;
    failures.push({ input: ATTACK6_URL, assertion: `page does not contain "${MUST_CONTAIN}"` });
  }

  for (const banned of MUST_NOT_CONTAIN) {
    if (!lc.includes(banned.toLowerCase())) {
      passed++;
    } else {
      failed++;
      failures.push({ input: ATTACK6_URL, assertion: `page contains stale string "${banned}"` });
    }
  }

  return { label: "6 – Caveat presence", casesRun: total, passed, failed, failures };
}

// ── Table renderer ─────────────────────────────────────────────────────────

function renderTable(attacks: AttackResult[]): void {
  const col = { label: 28, run: 10, pass: 9, fail: 7 };
  const header = [
    "Attack".padEnd(col.label),
    "Cases Run".padEnd(col.run),
    "Passed".padEnd(col.pass),
    "Failed",
  ].join(" | ");
  const sep = header.replace(/[^|]/g, "-").replace(/\|/g, "+");

  console.log("\n" + header);
  console.log(sep);
  for (const a of attacks) {
    const passCell = a.failed === 0 ? `${a.passed} ✓` : String(a.passed);
    const failCell = a.failed > 0   ? `${a.failed} ✗` : "0";
    console.log([
      a.label.padEnd(col.label),
      String(a.casesRun).padEnd(col.run),
      passCell.padEnd(col.pass),
      failCell,
    ].join(" | "));
  }
  console.log(sep);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=".repeat(66));
  console.log("Harsh-Critique Defense Test Suite");
  console.log("=".repeat(66));
  const matrix = buildMatrix();
  console.log(`Matrix    : ${matrix.length} combinations`);
  console.log(`FSRS-on   : ${matrix.filter(e => e.fsrs).length} (attacks 1, 2, 5 cover all)`);
  console.log(`No dev server required.  Attack 6 requires internet access.`);
  console.log("-".repeat(66));

  process.stdout.write("Attacks 1, 2, 4, 5 ... ");
  const a1 = runAttack1(matrix);
  const a2 = runAttack2(matrix);
  const a4 = runAttack4();
  const a5 = runAttack5(matrix);
  console.log("done");

  const a3 = runAttack3(); // prints inline output for each reproduction case

  process.stdout.write("\nAttack 6 (live fetch) ... ");
  const a6 = await runAttack6();
  console.log("done");

  const attacks = [a1, a2, a3, a4, a5, a6];
  renderTable(attacks);

  const overallPass = attacks.every(a => a.failed === 0);

  // Per-attack failure details
  for (const attack of attacks) {
    if (attack.failures.length === 0) continue;
    console.log(`\n${attack.label}:`);
    for (const f of attack.failures)
      console.log(`  ↳ [${f.input}]\n    ${f.assertion}`);
  }

  const totalRun    = attacks.reduce((s, a) => s + a.casesRun, 0);
  const totalPassed = attacks.reduce((s, a) => s + a.passed,   0);
  console.log(
    `\nSummary: ${totalPassed}/${totalRun} assertions passed` +
      (overallPass ? " ✓" : " — see failures above"),
  );

  if (!overallPass) process.exit(1);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
