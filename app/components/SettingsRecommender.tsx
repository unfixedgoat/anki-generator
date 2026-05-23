"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import {
  computePreset,
  densityToIntensity,
  type GoalProfile,
  type DifficultyAssessment,
  type AnkiPreset,
  type Warning,
} from "@/app/lib/settingsRecommender";
import { type GenerationInfo } from "./DropZone";

const GOAL_OPTIONS: { value: GoalProfile; label: string; sub: string }[] = [
  { value: "cram",             label: "Cram",      sub: "Optimize for exam date, retention not prioritized" },
  { value: "exam_then_retain", label: "Ace & Keep", sub: "Ace exam, want it to stick" },
  { value: "balanced",         label: "Balanced",  sub: "Long-term with exam milestone" },
  { value: "long_term",        label: "Long-term", sub: "No exam, permanent memory" },
];

const DIFFICULTY_OPTIONS: { value: DifficultyAssessment; label: string }[] = [
  { value: "easy",   label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard",   label: "Hard" },
];

const DENSITY_LABELS: Record<string, string> = {
  "high-yield":    "High-yield",
  "comprehensive": "Comprehensive",
  "granular":      "Granular",
};

// ─── Small shared UI pieces ───────────────────────────────────────────────────

function Field({
  label,
  value,
  rationale,
}: {
  label: string;
  value: string | number | boolean;
  rationale?: string;
}) {
  const [open, setOpen] = useState(false);
  const displayVal = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  return (
    <div className="flex items-start justify-between py-1 border-b border-slate-100 last:border-0 gap-4">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[12px] text-slate-500 truncate">{label}</span>
        {rationale && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} reasoning`}
            className="flex-shrink-0 w-4 h-4 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-600 text-[9px] font-bold transition-colors leading-none flex items-center justify-center focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-400 focus-visible:ring-offset-1"
          >
            ?
          </button>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <span className="text-[12px] font-medium text-slate-700 font-mono">{displayVal}</span>
        {open && rationale && (
          <p className="text-[10px] text-slate-400 leading-relaxed mt-1 max-w-[220px] text-right animate-fade-up">
            {rationale}
          </p>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">{title}</p>
      <div className="bg-white border border-slate-100 rounded-xl px-[10px] py-2">{children}</div>
    </div>
  );
}

// ─── Warning card with optional remediation button ────────────────────────────

function WarningCard({
  warning,
  onRegenerate,
  isRegenerating,
}: {
  warning: Warning;
  onRegenerate?: (density: string) => void;
  isRegenerating: boolean;
}) {
  const bgClass =
    warning.severity === "blocking"
      ? "bg-red-50 border-red-100"
      : "bg-amber-50 border-amber-100";
  const textClass =
    warning.severity === "blocking" ? "text-red-700" : "text-amber-700";

  const rem = warning.remediation;
  const canRegenerate =
    rem?.type === "regenerate_at_lower_intensity" &&
    rem.suggested_density &&
    onRegenerate;

  return (
    <div className={`rounded-xl border px-4 py-3 space-y-2 ${bgClass}`}>
      <p className={`text-[11px] leading-relaxed ${textClass}`}>⚠ {warning.message}</p>
      {canRegenerate && (
        <button
          type="button"
          onClick={() => onRegenerate!(rem!.suggested_density!)}
          disabled={isRegenerating}
          className={[
            "flex items-center gap-1.5 text-[10px] font-medium tracking-wide",
            "px-3 py-1.5 rounded-full border transition-colors duration-150",
            "border-[#c97f1a] text-[#7a4f0d] hover:bg-[#fef8ee]",
            isRegenerating ? "opacity-50 cursor-not-allowed" : "",
          ].join(" ")}
        >
          {isRegenerating && <Loader2 className="w-3 h-3 animate-spin" />}
          Regenerate at {DENSITY_LABELS[rem!.suggested_density!] ?? rem!.suggested_density} intensity
          {rem!.estimated_card_count ? ` (~${rem!.estimated_card_count} cards)` : ""}
        </button>
      )}
    </div>
  );
}

// ─── Preset output display ────────────────────────────────────────────────────

function PresetDisplay({
  preset,
  useFsrs,
  apkgBlob,
  genInfo,
  onRegenerate,
  isRegenerating,
}: {
  preset: AnkiPreset;
  useFsrs: boolean;
  apkgBlob: Blob | null;
  genInfo: GenerationInfo | null;
  onRegenerate: (density: string) => void;
  isRegenerating: boolean;
}) {
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [embedError, setEmbedError] = useState<string | null>(null);

  const rationaleFor = (field: string) =>
    preset.rationale.find((r) => r.field === field)?.reason;

  const finishLabel = preset.estimated_finish_date
    ? new Date(preset.estimated_finish_date + "T00:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "—";

  async function handleEmbedDownload() {
    if (!apkgBlob) return;
    setIsEmbedding(true);
    setEmbedError(null);
    try {
      const fd = new FormData();
      fd.append("apkg", new File([apkgBlob], "deck.apkg", { type: "application/octet-stream" }));
      fd.append("preset", JSON.stringify(preset));
      const res = await fetch("/api/embed-preset", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `Error ${res.status}` }));
        throw new Error(data.error ?? `Error ${res.status}`);
      }
      const blob = await res.blob();
      const baseName = genInfo?.filename.replace(/\.apkg$/i, "") ?? "anki_deck";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}_with_settings.apkg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setEmbedError(err instanceof Error ? err.message : "Embed failed");
    } finally {
      setIsEmbedding(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* FSRS disclaimer — positioned above everything else */}
      {useFsrs && (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
          <p className="text-[10px] text-slate-500 leading-relaxed">
            <span className="font-semibold text-slate-600">Starting defaults for new decks.</span>{" "}
            Once you have ~1,000 reviews, run{" "}
            <span className="font-medium">FSRS Optimize</span> and{" "}
            <span className="font-medium">Compute Minimum Recommended Retention</span> in Deck Options — those use your personal data and override this tool&apos;s retention suggestion.
          </p>
        </div>
      )}

      {/* Summary bar — new cards/day + finish date only (review load is FSRS's job) */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "new cards / day", val: preset.estimated_daily_new_cards, amber: false },
          { label: "new cards done",  val: finishLabel,                       amber: true  },
        ].map(({ label, val, amber }) => (
          <div key={label} className="bg-white border border-slate-100 rounded-xl px-3 py-1.5 text-center">
            <p className={["text-[18px] font-semibold leading-none", amber ? "text-[#c97f1a]" : "text-slate-800"].join(" ")}>{val}</p>
            <p className="text-[10px] text-slate-400 mt-1 tracking-wide">{label}</p>
          </div>
        ))}
      </div>

      {/* FSRS simulator nudge */}
      {useFsrs && (
        <p className="text-[10px] text-slate-400 text-center leading-relaxed">
          Review load grows over time. For an accurate forecast, use{" "}
          <span className="font-medium text-slate-500">Deck Options → FSRS → Workload</span>{" "}
          after ~1,000 reviews.
        </p>
      )}

      {/* Warnings + remediation */}
      {preset.warnings.length > 0 && (
        <div className="space-y-2">
          {preset.warnings.map((w, i) => (
            <WarningCard
              key={i}
              warning={w}
              onRegenerate={onRegenerate}
              isRegenerating={isRegenerating}
            />
          ))}
        </div>
      )}

      {/* Rationale hint — above the grid so users see it before interacting */}
      <p className="text-[10px] text-slate-400 text-center tracking-wide -mb-1">
        Tap <span className="font-bold text-slate-500">?</span> next to any field for the reasoning.
      </p>

      {/* Preset sections — 1-col on mobile, 2-col on tablet+ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Section title="Daily Limits">
          <Field label="New cards / day"       value={preset.new_cards_per_day}                   rationale={rationaleFor("new_cards_per_day")} />
          <Field label="Max reviews / day"     value={preset.maximum_reviews_per_day}             rationale={rationaleFor("maximum_reviews_per_day")} />
          <Field label="Ignore review limit"   value={preset.new_cards_ignore_review_limit} />
          <Field label="Limits from top"       value={preset.limits_start_from_top} />
        </Section>

        <Section title="New Cards">
          <Field label="Learning steps"        value={preset.learning_steps}                      rationale={rationaleFor("learning_steps")} />
          {!preset.fsrs_enabled && (
            <Field label="Graduating interval" value={`${preset.graduating_interval}d`}           rationale={rationaleFor("graduating_interval")} />
          )}
          {!preset.fsrs_enabled && (
            <Field label="Easy interval"       value={`${preset.easy_interval}d`}                 rationale={rationaleFor("easy_interval")} />
          )}
          <Field label="Insertion order"       value={preset.insertion_order === "random" ? "Random" : "Sequential"} rationale={rationaleFor("insertion_order")} />
        </Section>

        <Section title="Lapses">
          <Field label="Relearning steps"      value={preset.relearning_steps}                    rationale={rationaleFor("relearning_steps")} />
          <Field label="Min interval"          value={`${preset.minimum_interval}d`}              rationale={rationaleFor("minimum_interval")} />
          <Field label="Leech threshold"       value={preset.leech_threshold}                     rationale={rationaleFor("leech_threshold")} />
          <Field label="Leech action"          value={preset.leech_action === "tag_only" ? "Tag only" : "Suspend"} rationale={rationaleFor("leech_action")} />
        </Section>

        {useFsrs && (
          <Section title="FSRS">
            <Field label="FSRS enabled"      value={true} />
            <Field label="Desired retention" value={`${(preset.desired_retention * 100).toFixed(0)}%`} rationale={rationaleFor("desired_retention")} />
            <Field label="Max interval"      value={preset.maximum_interval === 36500 ? "36500d (100 yr)" : `${preset.maximum_interval}d`} rationale={rationaleFor("maximum_interval")} />
          </Section>
        )}
      </div>

      {/* Download actions */}
      {apkgBlob && (
        <div className="flex flex-col gap-2">
          <motion.button
            type="button"
            onClick={handleEmbedDownload}
            disabled={isEmbedding}
            className={[
              "w-full py-3 rounded-full text-[11px] font-medium tracking-widest uppercase",
              "bg-[#c97f1a] text-white transition-opacity duration-150 flex items-center justify-center gap-2",
              isEmbedding ? "opacity-60 cursor-not-allowed" : "opacity-100 hover:opacity-90",
            ].join(" ")}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
          >
            {isEmbedding && <Loader2 className="w-3 h-3 animate-spin" />}
            {isEmbedding ? "Embedding…" : "Download with Settings Embedded"}
          </motion.button>
          {embedError && (
            <p className="text-[10px] text-red-400 text-center">{embedError}</p>
          )}
          <p className="text-[10px] text-slate-400 text-center tracking-wide">
            Imports into Anki with these settings already applied.
          </p>
          <p className="text-[10px] text-slate-500 text-center tracking-wide">
            When importing, select <em>Import with deck presets</em> in the Anki import dialog.
          </p>
        </div>
      )}

    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  genInfo?: GenerationInfo | null;
  onNewGenInfo?: (info: GenerationInfo) => void;
}

export default function SettingsRecommender({ genInfo = null, onNewGenInfo }: Props) {
  const [useFsrs, setUseFsrs]                    = useState(true);
  const [daysUntilExam, setDaysUntilExam]        = useState("");
  const [goal, setGoal]                          = useState<GoalProfile>("balanced");
  const [budget, setBudget]                      = useState("");
  const [difficulty, setDifficulty]              = useState<DifficultyAssessment>("medium");
  const [preset, setPreset]                      = useState<AnkiPreset | null>(null);
  const [isRegenerating, setIsRegenerating]      = useState(false);
  const [inputsCollapsed, setInputsCollapsed]    = useState(false);
  const [manualCardCount, setManualCardCount]    = useState(() =>
    genInfo?.cardCount != null ? String(genInfo.cardCount) : ""
  );

  // live card count — starts from prop, updates when regeneration succeeds
  const [liveCardCount, setLiveCardCount]    = useState<number | null>(null);
  const [liveBlob, setLiveBlob]              = useState<Blob | null>(null);
  const [liveGenInfo, setLiveGenInfo]        = useState<GenerationInfo | null>(null);

  // sync manual input when an external deck count arrives (initial prop or regeneration)
  useEffect(() => {
    const from = liveCardCount ?? genInfo?.cardCount;
    if (from != null) setManualCardCount(String(from));
  }, [liveCardCount, genInfo?.cardCount]);

  // move focus to output when preset first appears
  const presetOutputRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (preset) presetOutputRef.current?.focus();
  }, [preset]);


  const cardCount  = manualCardCount !== "" ? (parseInt(manualCardCount, 10) || null) : null;
  const apkgBlob   = liveBlob       ?? genInfo?.blob       ?? null;
  const activeInfo = liveGenInfo    ?? genInfo;

  const goalIndex  = GOAL_OPTIONS.findIndex((o) => o.value === goal);

  function parsePosInt(val: string): number | null {
    const n = parseInt(val, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function calculate() {
    if (!cardCount) return;
    const days  = parsePosInt(daysUntilExam);
    const mins  = parsePosInt(budget);
    const intensity = activeInfo ? densityToIntensity(activeInfo.density) : undefined;
    setPreset(
      computePreset({
        deck_sizes: [cardCount],
        days_until_exam: days,
        goal,
        daily_minutes_budget: mins,
        difficulty_self_assessment: difficulty,
        intensity_mode: intensity,
        fsrs_enabled: useFsrs,
      })
    );
    setInputsCollapsed(true);
  }

  async function handleRegenerate(newDensity: string) {
    if (!activeInfo?.text) return;
    setIsRegenerating(true);
    try {
      const fd = new FormData();
      fd.append("text", activeInfo.text);
      fd.append("density", newDensity);
      fd.append("style", activeInfo.style);
      fd.append("filename", activeInfo.filename);
      const res = await fetch("/api/generate", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `Error ${res.status}` }));
        throw new Error(data.error ?? `Error ${res.status}`);
      }
      const blob      = await res.blob();
      const newCount  = parseInt(res.headers.get("X-Card-Count") ?? "0", 10);
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match       = disposition.match(/filename="([^"]+)"/);
      const filename    = match?.[1] ?? "anki_deck.apkg";

      // Trigger download for the regenerated deck
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const newInfo: GenerationInfo = {
        blob, filename, cardCount: newCount,
        density: newDensity as GenerationInfo["density"],
        style: activeInfo.style,
        text: activeInfo.text,
      };
      setLiveCardCount(newCount);
      setLiveBlob(blob);
      setLiveGenInfo(newInfo);
      onNewGenInfo?.(newInfo);

      // Recalculate preset with new count
      const days     = daysUntilExam ? parseInt(daysUntilExam, 10) : null;
      const mins     = budget        ? parseInt(budget, 10)        : null;
      const intensity = densityToIntensity(newDensity);
      setPreset(
        computePreset({
          deck_sizes: [newCount],
          days_until_exam: days,
          goal,
          daily_minutes_budget: mins,
          difficulty_self_assessment: difficulty,
          intensity_mode: intensity,
          fsrs_enabled: useFsrs,
        })
      );
    } catch (err) {
      console.error("Regeneration failed:", err);
    } finally {
      setIsRegenerating(false);
    }
  }

  const canCalculate = cardCount !== null && cardCount > 0;

  return (
    <div className="w-full flex flex-col gap-2">
      {/* STATIC — never inside any animated container */}
      <div className="text-center space-y-1 relative flex-shrink-0 min-h-[44px]">
        <h2 className="text-base font-sans font-medium text-slate-800 tracking-tight">
          Settings Recommender
        </h2>
        <p className="text-[11px] text-slate-400 tracking-wide">
          Starting defaults for new decks — for personalized tuning, use FSRS Optimize after ~1,000 reviews
        </p>
      </div>

      {/* Full inputs — visible when not collapsed */}
      {!inputsCollapsed && (
        <div key="inputs" className="w-full space-y-1.5 animate-fade-in">
          {/* FSRS toggle — first question, gates the entire output */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-medium uppercase tracking-widest text-slate-400 text-center">
              Using FSRS?
            </label>
            <div className="bg-[#f5f3ee] rounded-full p-[3px] flex w-full">
              {([{ value: true, label: "Yes — FSRS" }, { value: false, label: "No — SM-2" }] as { value: boolean; label: string }[]).map(({ value, label }) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => setUseFsrs(value)}
                  className={[
                    "relative flex-1 py-[7px] rounded-full text-[10px] text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c97f1a] focus-visible:ring-offset-1 focus-visible:ring-offset-[#f5f3ee]",
                    useFsrs === value
                      ? "text-[#7a4f0d] font-medium"
                      : "text-slate-400 hover:text-slate-600",
                  ].join(" ")}
                >
                  {useFsrs === value && (
                    <motion.div
                      layoutId="fsrs-active-pill"
                      className="absolute inset-0 bg-white rounded-full shadow-sm"
                      transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.8 }}
                    />
                  )}
                  <span className="relative z-10">{label}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 text-center">
              {useFsrs
                ? "Modern algorithm — enabled by default in new Anki profiles"
                : "Legacy SM-2 algorithm — all classic settings apply"}
            </p>
          </div>

          {/* Card count */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-medium uppercase tracking-widest text-slate-400 text-center">
              Card count
            </label>
            <input
              type="number"
              min={1}
              value={manualCardCount}
              onChange={(e) => setManualCardCount(e.target.value)}
              placeholder="number of cards in your deck"
              className="w-full px-4 py-1.5 rounded-full border border-[#f0c87a] bg-white text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-[#c97f1a] transition-colors text-center"
            />
          </div>

          {/* Days until exam */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-medium uppercase tracking-widest text-slate-400 text-center">
              Days until exam
            </label>
            <input
              type="number"
              min={1}
              value={daysUntilExam}
              onChange={(e) => setDaysUntilExam(e.target.value)}
              placeholder="leave blank if no exam"
              className="w-full px-4 py-1.5 rounded-full border border-[#f0c87a] bg-white text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-[#c97f1a] transition-colors text-center"
            />
          </div>

          {/* Goal pill selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-medium uppercase tracking-widest text-slate-400 text-center">
              Goal
            </label>
            <div className="bg-[#f5f3ee] rounded-full p-[3px] flex w-full">
              {GOAL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setGoal(opt.value)}
                  className={[
                    "relative flex-1 py-[7px] rounded-full text-[10px] text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c97f1a] focus-visible:ring-offset-1 focus-visible:ring-offset-[#f5f3ee]",
                    goal === opt.value
                      ? "text-[#7a4f0d] font-medium"
                      : "text-slate-400 hover:text-slate-600",
                  ].join(" ")}
                >
                  {goal === opt.value && (
                    <motion.div
                      layoutId="goal-active-pill"
                      className="absolute inset-0 bg-white rounded-full shadow-sm"
                      transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.8 }}
                    />
                  )}
                  <span className="relative z-10">{opt.label}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 text-center">
              {GOAL_OPTIONS[goalIndex].sub}
            </p>
          </div>

          {/* Difficulty + Budget row */}
          <div className="flex gap-3">
            <fieldset className="flex-1 flex flex-col gap-1.5 border-0 p-0 m-0 min-w-0">
              <legend className="text-[10px] font-medium uppercase tracking-widest text-slate-400 text-center w-full float-none">
                Material difficulty
              </legend>
              <div className="bg-[#f5f3ee] rounded-full p-[3px] flex w-full">
                {DIFFICULTY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDifficulty(opt.value)}
                    aria-pressed={difficulty === opt.value}
                    className={[
                      "relative flex-1 py-[7px] rounded-full text-[10px] text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c97f1a] focus-visible:ring-offset-1 focus-visible:ring-offset-[#f5f3ee]",
                      difficulty === opt.value
                        ? "text-[#7a4f0d] font-medium"
                        : "text-slate-400 hover:text-slate-600",
                    ].join(" ")}
                  >
                    {difficulty === opt.value && (
                      <motion.div
                        layoutId="difficulty-active-pill"
                        className="absolute inset-0 bg-white rounded-full shadow-sm"
                        transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.8 }}
                      />
                    )}
                    <span className="relative z-10">{opt.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-[10px] font-medium uppercase tracking-widest text-slate-400 text-center">
                Min / day budget
              </label>
              <input
                type="number"
                min={1}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="optional"
                className="w-full px-4 py-1.5 rounded-full border border-[#f0c87a] bg-white text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-[#c97f1a] transition-colors text-center"
              />
            </div>
          </div>
        </div>
      )}

      {/* Compact summary pills — visible when collapsed */}
      {inputsCollapsed && (
        <div key="pills" className="w-full flex items-stretch gap-2 animate-fade-in">
          {([
            { label: "FSRS",       value: useFsrs ? "On" : "Off" },
            { label: "Cards",      value: String(cardCount ?? "—") },
            { label: "Days",       value: daysUntilExam || "—" },
            { label: "Goal",       value: GOAL_OPTIONS.find((o) => o.value === goal)?.label ?? goal },
          ] as { label: string; value: string }[]).map(({ label, value }) => (
            <div
              key={label}
              className="flex-1 flex flex-col items-center gap-0.5 bg-[#fef8ee] border border-[#f0c87a] rounded-2xl px-2 py-2"
            >
              <span className="text-[8px] font-semibold uppercase tracking-widest text-[#c97f1a]">
                {label}
              </span>
              <span className="text-[11px] font-medium text-[#7a4f0d] leading-tight text-center">
                {value}
              </span>
            </div>
          ))}
          <button
            type="button"
            onClick={() => { setInputsCollapsed(false); setPreset(null); }}
            className="flex-shrink-0 self-center px-3 py-1.5 rounded-full border border-slate-200 text-[10px] font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Edit
          </button>
        </div>
      )}

      {/* Calculate / Recalculate — always visible */}
      <motion.button
        type="button"
        onClick={calculate}
        disabled={!canCalculate}
        className={[
          "w-full py-2 rounded-full text-[11px] font-medium tracking-widest uppercase transition-opacity duration-150",
          "bg-[#c97f1a] text-white",
          canCalculate ? "opacity-100 hover:opacity-90" : "opacity-25 cursor-not-allowed",
        ].join(" ")}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
      >
        {inputsCollapsed
          ? "Recalculate"
          : cardCount
          ? `Calculate Preset for ${cardCount} Cards`
          : "Calculate Preset"}
      </motion.button>

      {/* Output — mt-2 on wrapper separates input zone from output zone */}
      {preset && (
        <div ref={presetOutputRef} tabIndex={-1} aria-live="polite" className="mt-2 w-full animate-fade-up outline-none">
          <PresetDisplay
            preset={preset}
            useFsrs={useFsrs}
            apkgBlob={apkgBlob}
            genInfo={activeInfo}
            onRegenerate={handleRegenerate}
            isRegenerating={isRegenerating}
          />
        </div>
      )}
    </div>
  );
}
