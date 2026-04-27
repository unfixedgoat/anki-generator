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
          "relative inline-grid grid-cols-3 bg-slate-100 rounded-full p-[3px]",
          "transition-opacity duration-200",
          disabled ? "opacity-40 pointer-events-none" : "",
        ].join(" ")}
        role="group"
        aria-label="Card density"
      >
        {/* Sliding white pill */}
        <div
          aria-hidden
          className="absolute rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.10)] transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{
            top: "3px",
            bottom: "3px",
            width: "calc(33.333% - 2px)",
            left: `calc(${selectedIndex * 33.333}% + 1px)`,
          }}
        />

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
                "relative z-10 px-5 py-[7px] text-[11px] font-medium tracking-[0.06em] uppercase",
                "rounded-full transition-colors duration-150 outline-none",
                "focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1",
                isActive ? "text-slate-800" : "text-slate-400 hover:text-slate-500",
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
        className="text-[11px] text-slate-400 tracking-wide animate-in fade-in duration-200"
      >
        {description}
      </p>
    </div>
  );
}
