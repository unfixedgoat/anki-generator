"use client";

export type CardStyle =
  | "standard"
  | "cloze"
  | "concise"
  | "essay"
  | "mcq"
  | "solve"
  | "formula"
  | "custom";

interface Option {
  value: CardStyle;
  label: string;
  subtitle: string;
}

const OPTIONS: Option[] = [
  { value: "standard", label: "Standard", subtitle: "Q&A sentence" },
  { value: "cloze",    label: "Cloze",    subtitle: "Fill in blank" },
  { value: "concise",  label: "Concise",  subtitle: "Short answer" },
  { value: "essay",    label: "Essay",    subtitle: "Long form" },
  { value: "mcq",      label: "MCQ",      subtitle: "4 choices" },
  { value: "solve",    label: "Solve",    subtitle: "Step by step" },
  { value: "formula",  label: "Formula",  subtitle: "Math & chem" },
  { value: "custom",   label: "Custom",   subtitle: "Your prompt" },
];

interface Props {
  value: CardStyle;
  onChange: (value: CardStyle) => void;
  disabled?: boolean;
}

export default function StyleToggle({ value, onChange, disabled = false }: Props) {
  return (
    <div
      className={[
        "w-full transition-opacity duration-200",
        disabled ? "opacity-40 pointer-events-none" : "",
      ].join(" ")}
      role="group"
      aria-label="Card style"
    >
      <div className="grid grid-cols-4 gap-[5px]">
        {OPTIONS.map((opt) => {
          const isActive = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(opt.value)}
              className={[
                "rounded-lg border px-2 py-1.5 text-center cursor-pointer text-[11px]",
                "transition-colors duration-150 outline-none",
                "focus-visible:ring-2 focus-visible:ring-[#c97f1a] focus-visible:ring-offset-1",
                isActive
                  ? "border-[#c97f1a] text-[#7a4f0d] bg-[#fef8ee] font-medium"
                  : "border-slate-200 bg-white text-slate-600",
              ].join(" ")}
            >
              <p>{opt.label}</p>
              <p className={["text-[9px]", isActive ? "text-[#c97f1a]" : "text-slate-400"].join(" ")}>
                {opt.subtitle}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
