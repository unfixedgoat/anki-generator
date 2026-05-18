"use client";

import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
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
  { value: "cram",             label: "Cram",      sub: "Exam soon, forget after is fine" },
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
    <div className="flex items-start justify-between py-2.5 border-b border-slate-100 last:border-0 gap-4">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[12px] text-slate-500 truncate">{label}</span>
        {rationale && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex-shrink-0 w-4 h-4 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-600 text-[9px] font-bold transition-colors leading-none flex items-center justify-center"
          >
            ?
          </button>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <span className="text-[12px] font-medium text-slate-700 font-mono">{displayVal}</span>
        {open && rationale && (
          <p className="text-[10px] text-slate-400 leading-relaxed mt-1 max-w-[220px] text-right">
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
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">{title}</p>
      <div className="bg-white border border-slate-100 rounded-xl px-4">{children}</div>
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
  apkgBlob,
  genInfo,
  onRegenerate,
  isRegenerating,
}: {
  preset: AnkiPreset;
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
    <div className="flex flex-col gap-5 w-full">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "min / day",      val: preset.estimated_daily_minutes, amber: false },
          { label: "reviews / day",  val: preset.estimated_daily_reviews, amber: false },
          { label: "new cards done", val: finishLabel,                    amber: true  },
        ].map(({ label, val, amber }) => (
          <div key={label} className="bg-white border border-slate-100 rounded-xl px-3 py-3 text-center">
            <p className={["text-[18px] font-semibold leading-none", amber ? "text-[#c97f1a]" : "text-slate-800"].join(" ")}>{val}</p>
            <p className="text-[10px] text-slate-400 mt-1 tracking-wide">{label}</p>
          </div>
        ))}
      </div>

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

      {/* Preset sections */}
      <Section title="Daily Limits">
        <Field label="New cards / day"            value={preset.new_cards_per_day}           rationale={rationaleFor("new_cards_per_day")} />
        <Field label="Maximum reviews / day"      value={preset.maximum_reviews_per_day}     rationale={rationaleFor("maximum_reviews_per_day")} />
        <Field label="New cards ignore review limit" value={preset.new_cards_ignore_review_limit} />
        <Field label="Limits start from top"      value={preset.limits_start_from_top} />
      </Section>

      <Section title="New Cards">
        <Field label="Learning steps"    value={preset.learning_steps}                         rationale={rationaleFor("learning_steps")} />
        <Field label="Graduating interval" value={`${preset.graduating_interval}d`}            rationale={rationaleFor("graduating_interval")} />
        <Field label="Easy interval"     value={`${preset.easy_interval}d`}                    rationale={rationaleFor("easy_interval")} />
        <Field label="Insertion order"   value={preset.insertion_order === "random" ? "Random" : "Sequential"} rationale={rationaleFor("insertion_order")} />
      </Section>

      <Section title="Lapses">
        <Field label="Relearning steps"  value={preset.relearning_steps}                       rationale={rationaleFor("relearning_steps")} />
        <Field label="Minimum interval"  value={`${preset.minimum_interval}d`}                 rationale={rationaleFor("minimum_interval")} />
        <Field label="Leech threshold"   value={preset.leech_threshold}                        rationale={rationaleFor("leech_threshold")} />
        <Field label="Leech action"      value={preset.leech_action === "tag_only" ? "Tag only" : "Suspend"} rationale={rationaleFor("leech_action")} />
      </Section>

      <Section title="FSRS">
        <Field label="FSRS enabled"      value={true} />
        <Field label="Desired retention" value={`${(preset.desired_retention * 100).toFixed(0)}%`} rationale={rationaleFor("desired_retention")} />
        <Field label="Maximum interval"  value={preset.maximum_interval === 36500 ? "36500d (100 yr)" : `${preset.maximum_interval}d`} rationale={rationaleFor("maximum_interval")} />
      </Section>

      {/* Download actions */}
      {apkgBlob && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleEmbedDownload}
            disabled={isEmbedding}
            className={[
              "w-full py-3 rounded-full text-[11px] font-medium tracking-widest uppercase",
              "bg-[#c97f1a] text-white transition-opacity duration-150 flex items-center justify-center gap-2",
              isEmbedding ? "opacity-60 cursor-not-allowed" : "opacity-100",
            ].join(" ")}
          >
            {isEmbedding && <Loader2 className="w-3 h-3 animate-spin" />}
            {isEmbedding ? "Embedding…" : "Download with Settings Embedded"}
          </button>
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

      <p className="text-[10px] text-slate-400 text-center tracking-wide">
        Tap <span className="font-bold text-slate-500">?</span> next to any field for the reasoning behind that setting.
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  genInfo?: GenerationInfo | null;
  onNewGenInfo?: (info: GenerationInfo) => void;
}

export default function SettingsRecommender({ genInfo = null, onNewGenInfo }: Props) {
  const [daysUntilExam, setDaysUntilExam]   = useState("");
  const [goal, setGoal]                      = useState<GoalProfile>("balanced");
  const [budget, setBudget]                  = useState("");
  const [difficulty, setDifficulty]          = useState<DifficultyAssessment>("medium");
  const [preset, setPreset]                  = useState<AnkiPreset | null>(null);
  const [isRegenerating, setIsRegenerating]  = useState(false);

  // live card count — starts from prop, updates when regeneration succeeds
  const [liveCardCount, setLiveCardCount]    = useState<number | null>(null);
  const [liveBlob, setLiveBlob]              = useState<Blob | null>(null);
  const [liveGenInfo, setLiveGenInfo]        = useState<GenerationInfo | null>(null);

  const cardCount  = liveCardCount  ?? genInfo?.cardCount  ?? null;
  const apkgBlob   = liveBlob       ?? genInfo?.blob       ?? null;
  const activeInfo = liveGenInfo    ?? genInfo;

  const goalIndex  = GOAL_OPTIONS.findIndex((o) => o.value === goal);

  function calculate() {
    if (!cardCount) return;
    const days  = daysUntilExam ? parseInt(daysUntilExam, 10) : null;
    const mins  = budget        ? parseInt(budget, 10)        : null;
    const intensity = activeInfo ? densityToIntensity(activeInfo.density) : undefined;
    setPreset(
      computePreset({
        deck_sizes: [cardCount],
        days_until_exam: days,
        goal,
        daily_minutes_budget: mins,
        difficulty_self_assessment: difficulty,
        intensity_mode: intensity,
      })
    );
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
    <div className="h-full overflow-y-auto">
    <div className="flex flex-col items-center gap-6 w-full">
      {/* Header */}
      <div className="text-center space-y-1">
        <h2 className="text-base font-semibold text-slate-800 tracking-tight">
          Settings Recommender
        </h2>
        {cardCount !== null ? (
          <p className="text-[11px] text-slate-400 tracking-wide">
            Tuning settings for your{" "}
            <span className="font-semibold text-slate-600">{cardCount}-card deck</span>
          </p>
        ) : (
          <div className="flex flex-col items-center gap-2 py-2">
            <Lock className="w-9 h-9 text-[#f0c87a]" />
            <p className="text-slate-400 text-sm">Generate a deck above to unlock settings</p>
          </div>
        )}
      </div>

      {/* Inputs */}
      <div className={["w-full space-y-4", !cardCount ? "opacity-40 pointer-events-none" : ""].join(" ")}>
        {/* Days row — only shown; no deck size input (auto-populated) */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
            Days until exam
          </label>
          <input
            type="number"
            min={1}
            value={daysUntilExam}
            onChange={(e) => setDaysUntilExam(e.target.value)}
            placeholder="leave blank if no exam"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-[#c97f1a] transition-colors"
          />
        </div>

        {/* Goal pill selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
            Goal
          </label>
          <div className="bg-[#f5f3ee] rounded-full p-[3px] flex w-full">
            {GOAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setGoal(opt.value)}
                className={[
                  "flex-1 py-[7px] rounded-full text-[10px] transition-colors duration-150 outline-none text-center",
                  goal === opt.value
                    ? "bg-white text-[#7a4f0d] font-medium shadow-sm"
                    : "text-slate-400",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 text-center">
            {GOAL_OPTIONS[goalIndex].sub}
          </p>
        </div>

        {/* Difficulty + Budget row */}
        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
              Material difficulty
            </label>
            <div className="flex rounded-xl border border-slate-200 overflow-hidden">
              {DIFFICULTY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDifficulty(opt.value)}
                  className={[
                    "flex-1 py-2 text-[11px] font-medium transition-colors duration-150",
                    difficulty === opt.value
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-400 hover:text-slate-500",
                  ].join(" ")}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
              Min / day budget
            </label>
            <input
              type="number"
              min={1}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="optional"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-[#c97f1a] transition-colors"
            />
          </div>
        </div>

        {/* Calculate button */}
        <button
          type="button"
          onClick={calculate}
          disabled={!canCalculate}
          className={[
            "w-full py-3 rounded-full text-[11px] font-medium tracking-widest uppercase transition-opacity duration-150",
            "bg-[#c97f1a] text-white",
            canCalculate ? "opacity-100" : "opacity-25 cursor-not-allowed",
          ].join(" ")}
        >
          {cardCount ? `Calculate Preset for ${cardCount} Cards` : "Calculate Preset"}
        </button>
      </div>

      {/* Output */}
      {preset && (
        <PresetDisplay
          preset={preset}
          apkgBlob={apkgBlob}
          genInfo={activeInfo}
          onRegenerate={handleRegenerate}
          isRegenerating={isRegenerating}
        />
      )}
    </div>
    </div>
  );
}
