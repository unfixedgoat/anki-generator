"use client";

export type Density = "high-yield" | "comprehensive" | "granular";

interface Option {
  value: Density;
  label: string;
  description: string;
}

const OPTIONS: Option[] = [
  {
    value: "high-yield",
    label: "High-Yield",
    description: "Core concepts & pathways only.",
  },
  {
    value: "comprehensive",
    label: "Comprehensive",
    description: "Includes secondary details & clinical correlations.",
  },
  {
    value: "granular",
    label: "Granular",
    description: "PhD-level extraction of all testable facts.",
  },
];

interface Props {
  value: Density;
  onChange: (value: Density) => void;
  disabled?: boolean;
}

export default function DensityToggle({ value, onChange, disabled = false }: Props) {
  const selectedIndex = OPTIONS.findIndex((o) => o.value === value);
  const description = OPTIONS[selectedIndex].description;

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div
        className={[
          "inline-grid grid-cols-3 bg-[#f5f3ee] rounded-full p-[3px]",
          "transition-opacity duration-200",
          disabled ? "opacity-40 pointer-events-none" : "",
        ].join(" ")}
        role="group"
        aria-label="Card density"
      >
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
                "px-5 py-[7px] text-[11px] font-medium tracking-[0.04em] uppercase",
                "rounded-full transition-colors duration-150 outline-none",
                "focus-visible:ring-2 focus-visible:ring-[#c97f1a] focus-visible:ring-offset-1",
                isActive ? "bg-white text-[#7a4f0d] shadow-sm" : "text-slate-400 hover:text-slate-500",
              ].join(" ")}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Description line — fades on change via key trick */}
      <p
        key={value}
        className="text-[11px] text-slate-400 animate-in fade-in duration-200"
      >
        {description}
      </p>
    </div>
  );
}
