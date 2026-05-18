export type GoalProfile = "cram" | "exam_then_retain" | "balanced" | "long_term";
export type DifficultyAssessment = "easy" | "medium" | "hard";
export type IntensityMode = "light" | "standard" | "intensive";

export interface Remediation {
  type: "regenerate_at_lower_intensity" | "lower_retention" | "extend_exam_date";
  suggested_intensity?: IntensityMode;
  suggested_density?: string;
  estimated_card_count?: number;
}

export interface Warning {
  severity: "info" | "warning" | "blocking";
  code: "budget_exceeded" | "wont_finish_before_exam" | "aggressive_pace";
  message: string;
  remediation?: Remediation;
}

export interface RationaleItem {
  field: string;
  reason: string;
}

export interface AnkiPreset {
  new_cards_per_day: number;
  maximum_reviews_per_day: number;
  new_cards_ignore_review_limit: boolean;
  limits_start_from_top: boolean;
  learning_steps: string;
  graduating_interval: number;
  easy_interval: number;
  insertion_order: "sequential" | "random";
  relearning_steps: string;
  minimum_interval: number;
  leech_threshold: number;
  leech_action: "tag_only" | "suspend";
  desired_retention: number;
  fsrs_enabled: true;
  maximum_interval: number;
  estimated_daily_minutes: number;
  estimated_daily_new_cards: number;
  estimated_daily_reviews: number;
  estimated_finish_date: string | null;
  warnings: Warning[];
  rationale: RationaleItem[];
}

export interface RecommenderInput {
  deck_sizes: number[];
  days_until_exam: number | null;
  goal: GoalProfile;
  daily_minutes_budget?: number | null;
  cards_already_learned?: number;
  difficulty_self_assessment?: DifficultyAssessment;
  intensity_mode?: IntensityMode;
}

const INTENSITY_RATIOS: Record<IntensityMode, number> = {
  intensive: 1.0,
  standard: 0.71,
  light: 0.36,
};

const INTENSITY_TO_DENSITY: Record<IntensityMode, string> = {
  intensive: "granular",
  standard: "comprehensive",
  light: "high-yield",
};

export function densityToIntensity(density: string): IntensityMode {
  if (density === "high-yield") return "light";
  if (density === "granular") return "intensive";
  return "standard";
}

function lookupRetention(days: number | null, goal: GoalProfile): number {
  if (days === null || days > 180) {
    return goal === "long_term" ? 0.80 : 0.85;
  }
  if (days <= 7) return 0.97;
  if (days <= 14) {
    return goal === "cram" || goal === "exam_then_retain" ? 0.95 : 0.92;
  }
  if (days <= 30) {
    if (goal === "cram") return 0.93;
    if (goal === "exam_then_retain") return 0.92;
    if (goal === "balanced") return 0.90;
    return 0.88;
  }
  if (days <= 90) {
    if (goal === "cram" || goal === "exam_then_retain") return 0.90;
    if (goal === "balanced") return 0.88;
    return 0.85;
  }
  // 91–180
  if (goal === "cram" || goal === "exam_then_retain") return 0.88;
  if (goal === "balanced") return 0.85;
  return 0.82;
}

const MINS_PER_NEW = 0.4;
const MINS_PER_REVIEW = 0.15;

function computeRemediation(
  input: RecommenderInput,
  daysToIntroduce: number,
  totalSize: number
): Remediation | null {
  const { days_until_exam, intensity_mode } = input;
  if (!days_until_exam || !intensity_mode) return null;
  const current = intensity_mode;
  if (current === "light") return null;
  const currentRatio = INTENSITY_RATIOS[current];
  const baseSize = totalSize / currentRatio;
  const candidates: IntensityMode[] = current === "intensive" ? ["standard", "light"] : ["light"];
  for (const candidate of candidates) {
    if (INTENSITY_RATIOS[candidate] >= currentRatio) continue;
    const candidateSize = Math.round(baseSize * INTENSITY_RATIOS[candidate]);
    const candidatePace = Math.ceil(candidateSize / Math.max(1, daysToIntroduce));
    if (candidatePace <= 50) {
      return {
        type: "regenerate_at_lower_intensity",
        suggested_intensity: candidate,
        suggested_density: INTENSITY_TO_DENSITY[candidate],
        estimated_card_count: candidateSize,
      };
    }
  }
  return null;
}

// ─── Learning step selection ───────────────────────────────────────────────────
//
// Cram mode philosophy (goal=cram OR days≤7):
//   Multiple intra-day exposures are the whole game — you don't have time for
//   spaced repetition to do its work. All steps stay < 24h so FSRS can still
//   schedule any cards that graduate, but the sequence ensures you see hard
//   cards at 1m → 10m → 1h → 2h in a single sitting.
//   Source: Anki community consensus (docs.ankiweb.net + r/Anki cram guides).
//
// Standard mode (everything else):
//   Difficulty drives complexity. Easy material needs one confirmation step;
//   hard material earns a third step at 30m to cement the trace.

function pickSteps(
  isCramMode: boolean,
  difficulty: DifficultyAssessment
): { learning: string; relearning: string } {
  if (isCramMode) {
    if (difficulty === "easy") {
      // You probably have some familiarity — confirm at 10m then 1h.
      return { learning: "10m 60m", relearning: "1m 10m" };
    }
    // Medium / hard: full intra-day sequence.
    // "1m 10m 60m 120m" — four exposures in one sitting, none ≥ 24h.
    // Relearning is brutally short so forgotten cards loop back into the
    // queue almost immediately rather than disappearing until tomorrow.
    return { learning: "1m 10m 60m 120m", relearning: "1m 10m" };
  }

  // Standard / long-term modes — difficulty is the primary driver.
  if (difficulty === "easy") {
    return { learning: "10m", relearning: "10m" };
  }
  if (difficulty === "hard") {
    return { learning: "1m 10m 30m", relearning: "10m 30m" };
  }
  // medium
  return { learning: "1m 10m", relearning: "10m" };
}

export function computePreset(input: RecommenderInput): AnkiPreset {
  const {
    deck_sizes,
    days_until_exam,
    goal,
    daily_minutes_budget = null,
    cards_already_learned = 0,
    difficulty_self_assessment = "medium",
  } = input;

  const totalDeckSize = deck_sizes.reduce((a, b) => a + b, 0);
  const rationale: RationaleItem[] = [];
  const warnings: Warning[] = [];

  // Cram mode = user selected "Cram" goal, OR exam is ≤ 7 days away.
  // Both situations call for the same aggressive intra-day setup.
  const isCramMode =
    goal === "cram" || (days_until_exam !== null && days_until_exam <= 7);

  // ── Step 1 — desired_retention ──────────────────────────────────────────────
  const desired_retention = lookupRetention(days_until_exam, goal);
  const pct = (desired_retention * 100).toFixed(0);
  if (days_until_exam === null) {
    rationale.push({ field: "desired_retention", reason: `No exam deadline — optimizing for long-term efficiency at ${pct}% retention.` });
  } else if (days_until_exam <= 14) {
    rationale.push({ field: "desired_retention", reason: `Exam in ${days_until_exam} days — ${pct}% retention minimizes forgetting before you can review again.` });
  } else {
    rationale.push({ field: "desired_retention", reason: `${pct}% is the workload sweet spot for a ${days_until_exam}-day horizon with a ${goal.replace("_", " ")} goal.` });
  }

  // ── Step 2 — new_cards_per_day, maximum_reviews_per_day ────────────────────
  const remaining = Math.max(0, totalDeckSize - cards_already_learned);
  const effectiveDays = days_until_exam ?? 365;
  const buffer = Math.min(14, Math.floor(effectiveDays * 0.2));
  const daysToIntroduce = Math.max(1, effectiveDays - buffer);

  let new_cards_per_day: number;
  let maximum_reviews_per_day: number;
  // Separate variable for estimates so cram's 9999 doesn't break math.
  let estNewPerDay: number;

  if (isCramMode) {
    // Remove all throttles — you're going all-in.
    new_cards_per_day = 9999;
    maximum_reviews_per_day = 9999;
    estNewPerDay = Math.ceil(remaining / Math.max(1, effectiveDays));
    rationale.push({ field: "new_cards_per_day", reason: `9999 — no throttle in cram mode. Study every card available; let your session length be the only limit.` });
    rationale.push({ field: "maximum_reviews_per_day", reason: `9999 — same reasoning as new cards: Anki should never hold cards back during a cram session.` });
  } else {
    let computedNew = Math.ceil(remaining / daysToIntroduce);
    let budgetCapped = false;

    if (daily_minutes_budget) {
      const maxByBudget = Math.floor((daily_minutes_budget * 0.5) / MINS_PER_NEW);
      if (maxByBudget < computedNew) {
        computedNew = maxByBudget;
        budgetCapped = true;
      }
    }

    if (computedNew > 100) {
      const leftover = remaining - 100 * daysToIntroduce;
      const rem = computeRemediation(input, daysToIntroduce, totalDeckSize);
      warnings.push({
        severity: "blocking",
        code: "wont_finish_before_exam",
        message: `Deck won't finish before the exam at a sustainable pace — the last ~${Math.max(0, leftover)} cards may only be seen in cram mode.`,
        remediation: rem ?? undefined,
      });
      computedNew = 100;
    } else if (computedNew > 50) {
      warnings.push({
        severity: "warning",
        code: "aggressive_pace",
        message: `This is aggressive — most users plateau around 20–30 new cards/day. Consider reducing scope or extending the timeline.`,
      });
    }

    new_cards_per_day = computedNew;
    maximum_reviews_per_day = Math.min(9999, Math.max(200, new_cards_per_day * 10));
    estNewPerDay = new_cards_per_day;

    rationale.push({
      field: "new_cards_per_day",
      reason: budgetCapped
        ? `Capped at ${new_cards_per_day}/day by your ${daily_minutes_budget} min/day budget.`
        : `${new_cards_per_day}/day introduces all ${remaining} cards with ${buffer} days reserved for pure review before the exam.`,
    });
    rationale.push({ field: "maximum_reviews_per_day", reason: `10× new cards (${maximum_reviews_per_day}), per Anki's FSRS rule of thumb; floor of 200 prevents early bottlenecks.` });
  }

  // ── Step 3 — learning / relearning steps ───────────────────────────────────
  const { learning: learning_steps, relearning: relearning_steps } =
    pickSteps(isCramMode, difficulty_self_assessment);

  if (isCramMode) {
    rationale.push({
      field: "learning_steps",
      reason: difficulty_self_assessment === "easy"
        ? `Two intra-day touches (10m → 1h) — you have some familiarity, one confirmation per session is enough.`
        : `Four intra-day touches (1m → 10m → 1h → 2h) — guarantees multiple exposures in a single sitting. All steps < 24h so FSRS stays in control of anything that graduates.`,
    });
    rationale.push({ field: "relearning_steps", reason: `Brutally short (${relearning_steps}) — forgotten cards loop back into your queue almost immediately rather than disappearing until tomorrow.` });
  } else {
    rationale.push({
      field: "learning_steps",
      reason: difficulty_self_assessment === "easy"
        ? `Single 10m step — easy material only needs one confirmation before graduating.`
        : difficulty_self_assessment === "hard"
        ? `Three steps (1m → 10m → 30m) — harder material earns an extra touch at 30m to cement the memory trace.`
        : `Standard two-step sequence (1m → 10m). All steps < 1 day — FSRS requires this.`,
    });
    rationale.push({ field: "relearning_steps", reason: `Short relearning step gives the card one quick restudy before FSRS takes back over.` });
  }

  // ── Step 4 — graduating / easy / minimum interval ──────────────────────────
  const graduating_interval = 1;
  // Cram: easy interval 2 (article recommendation — cards shouldn't drift far
  // before the exam). Standard: 4 (modern Anki default).
  const easy_interval = isCramMode ? 2 : 4;
  const minimum_interval = 1;

  rationale.push({ field: "graduating_interval", reason: `1 day — with FSRS enabled Anki overrides this, but it's emitted for compatibility with non-FSRS versions.` });
  rationale.push({
    field: "easy_interval",
    reason: isCramMode
      ? `2 days — keeps cards close so they resurface before your exam.`
      : `4 days (modern Anki default) — rarely applied since FSRS computes intervals independently.`,
  });
  rationale.push({ field: "minimum_interval", reason: `1 day floor prevents Anki from scheduling a card for the same day it was studied.` });

  // ── Step 5 — leech threshold / action ──────────────────────────────────────
  let leech_threshold: number;
  if (isCramMode) {
    // 99 = effectively disabled. You cannot afford Anki auto-suspending a
    // difficult card the night before your exam — study it anyway.
    leech_threshold = 99;
  } else if (goal === "long_term") {
    leech_threshold = 12;
  } else {
    leech_threshold = 8;
  }

  const leech_action: "tag_only" = "tag_only";
  rationale.push({
    field: "leech_threshold",
    reason: isCramMode
      ? `99 (effectively disabled) — never auto-suspend a card the night before your exam. You need to see everything, even the hard ones.`
      : goal === "long_term"
      ? `High threshold (12) — you'll eventually master them; no rush to flag.`
      : `Standard (8) — flags persistent problem cards without being overly aggressive.`,
  });
  rationale.push({ field: "leech_action", reason: `Tag only — suspending silently removes cards from study and people forget to unsuspend.` });

  // ── Step 6 — insertion order ───────────────────────────────────────────────
  const insertion_order: "sequential" | "random" =
    isCramMode || (days_until_exam !== null && days_until_exam <= 14)
      ? "random"
      : "sequential";
  rationale.push({
    field: "insertion_order",
    reason: insertion_order === "random"
      ? `Random — broad coverage across all topics fast, not chapter-by-chapter.`
      : `Sequential — preserves the structure of well-organized decks.`,
  });

  // ── Step 7 — maximum interval ──────────────────────────────────────────────
  let maximum_interval: number;
  if (isCramMode && days_until_exam !== null) {
    maximum_interval = days_until_exam;
    rationale.push({ field: "maximum_interval", reason: `Capped at ${days_until_exam} days — no point scheduling cards beyond your exam date.` });
  } else {
    maximum_interval = 36500;
    rationale.push({ field: "maximum_interval", reason: `36500 days (100 years) — FSRS schedules to the optimal interval naturally.` });
  }

  // ── Step 8 — estimates (closed-form) ──────────────────────────────────────
  const learningReviewsPerCard = desired_retention >= 0.93 ? 5 : desired_retention >= 0.88 ? 4 : 3;
  const forgettingRate = 1 - desired_retention;
  const estimated_daily_reviews = Math.round(
    remaining * forgettingRate + estNewPerDay * learningReviewsPerCard
  );
  const estimated_daily_new_cards = estNewPerDay;
  const rawMinutes = estNewPerDay * MINS_PER_NEW + estimated_daily_reviews * MINS_PER_REVIEW;
  const estimated_daily_minutes = Math.round(rawMinutes * 10) / 10;

  let estimated_finish_date: string | null = null;
  if (remaining > 0 && estNewPerDay > 0) {
    const daysToFinish = Math.ceil(remaining / estNewPerDay);
    const finish = new Date();
    finish.setDate(finish.getDate() + daysToFinish);
    estimated_finish_date = finish.toISOString().slice(0, 10);

    if (!isCramMode && days_until_exam !== null) {
      const cutoffDays = days_until_exam - 7;
      if (daysToFinish > cutoffDays) {
        const covered = estNewPerDay * Math.max(0, cutoffDays);
        const uncovered = Math.max(0, remaining - covered);
        if (uncovered > 0 && !warnings.find(w => w.code === "wont_finish_before_exam")) {
          const rem = computeRemediation(input, daysToIntroduce, totalDeckSize);
          warnings.push({
            severity: "warning",
            code: "wont_finish_before_exam",
            message: `~${uncovered} cards won't be introduced 7 days before the exam — they'll only appear in late-stage cram sessions.`,
            remediation: rem ?? undefined,
          });
        }
      }
    }
  }

  if (!isCramMode && daily_minutes_budget && estimated_daily_minutes > daily_minutes_budget * 1.2) {
    const lowerRet = ((desired_retention - 0.03) * 100).toFixed(0);
    warnings.push({
      severity: "warning",
      code: "budget_exceeded",
      message: `You'll average ~${estimated_daily_minutes.toFixed(0)} min/day, exceeding your ${daily_minutes_budget} min budget. Options: lower retention to ${lowerRet}% or reduce new cards/day.`,
    });
  }

  return {
    new_cards_per_day,
    maximum_reviews_per_day,
    new_cards_ignore_review_limit: false,
    limits_start_from_top: false,
    learning_steps,
    graduating_interval,
    easy_interval,
    insertion_order,
    relearning_steps,
    minimum_interval,
    leech_threshold,
    leech_action,
    desired_retention,
    fsrs_enabled: true,
    maximum_interval,
    estimated_daily_minutes,
    estimated_daily_new_cards,
    estimated_daily_reviews,
    estimated_finish_date,
    warnings,
    rationale,
  };
}
