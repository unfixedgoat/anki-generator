"use client";

import { motion } from "framer-motion";

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
    description: "~6–9 cards per page · exam essentials only",
  },
  {
    value: "comprehensive",
    label: "Comprehensive",
    description: "~10–14 cards per page · core + supporting detail",
  },
  {
    value: "granular",
    label: "Granular",
    description: "~15–18 cards per page · every testable fact",
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
          "w-full grid grid-cols-3 bg-[#f5f3ee] rounded-full p-[3px]",
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
                "relative px-5 py-[7px] text-[10px] sm:text-[11px] font-medium tracking-tight sm:tracking-[0.04em] uppercase",
                "rounded-full outline-none",
                "focus-visible:ring-2 focus-visible:ring-[#c97f1a] focus-visible:ring-offset-1",
                isActive ? "text-[#7a4f0d]" : "text-slate-400 hover:text-slate-500",
              ].join(" ")}
            >
              {isActive && (
                <motion.div
                  layoutId="density-active-pill"
                  className="absolute inset-0 bg-white rounded-full shadow-sm"
                  transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.8 }}
                />
              )}
              <span className="relative z-10">{opt.label}</span>
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
