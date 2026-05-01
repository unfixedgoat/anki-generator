"use client";

export type CardStyle =
  | "standard"
  | "cloze"
  | "concise"
  | "essay"
  | "mcq"
  | "solve"
  | "formula";

interface Option {
  value: CardStyle;
  label: string;
  description: string;
}

const OPTIONS: Option[] = [
  {
    value: "standard",
    label: "Standard",
    description: "Clear question with a complete sentence answer.",
  },
  {
    value: "cloze",
    label: "Cloze",
    description: "Fill-in-the-blank with the key term removed.",
  },
  {
    value: "concise",
    label: "Concise",
    description: "Single word or short phrase answers only.",
  },
  {
    value: "essay",
    label: "Essay",
    description: "Deep, multi-part answers for thorough understanding.",
  },
  {
    value: "mcq",
    label: "MCQ",
    description: "Question with four options on the front, answer on the back.",
  },
  {
    value: "solve",
    label: "Solve",
    description: "Practice problem on the front, worked solution with units on the back.",
  },
  {
    value: "formula",
    label: "Formula",
    description: "Recall the equation or formula for a given concept.",
  },
];

const N = OPTIONS.length;

interface Props {
  value: CardStyle;
  onChange: (value: CardStyle) => void;
  disabled?: boolean;
}

export default function StyleToggle({ value, onChange, disabled = false }: Props) {
  const selectedIndex = OPTIONS.findIndex((o) => o.value === value);
  const description = OPTIONS[selectedIndex].description;

  return (
    <div className="flex flex-col items-center gap-2.5 w-full max-w-xl">
      <div
        className={[
          "relative inline-grid bg-slate-100 rounded-full p-[3px] w-full",
          "transition-opacity duration-200",
          disabled ? "opacity-40 pointer-events-none" : "",
        ].join(" ")}
        style={{ gridTemplateColumns: `repeat(${N}, 1fr)` }}
        role="group"
        aria-label="Card style"
      >
        {/* Sliding white pill */}
        <div
          aria-hidden
          className="absolute rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.10)] transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{
            top: "3px",
            bottom: "3px",
            width: `calc(${100 / N}% - 2px)`,
            left: `calc(${(selectedIndex * 100) / N}% + 1px)`,
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
                "relative z-10 py-[7px] text-[10px] font-medium tracking-[0.04em] uppercase",
                "rounded-full transition-colors duration-150 outline-none text-center",
                "focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1",
                isActive ? "text-slate-800" : "text-slate-400 hover:text-slate-500",
              ].join(" ")}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <p
        key={value}
        className="text-[11px] text-slate-400 tracking-wide animate-in fade-in duration-200"
      >
        {description}
      </p>
    </div>
  );
}
