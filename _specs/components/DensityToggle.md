# DensityToggle component

`app/components/DensityToggle.tsx`

## Props

```ts
interface Props {
  value: Density;                    // controlled value
  onChange: (value: Density) => void;
  disabled?: boolean;                // defaults to false
}
```

`Density` (exported): `"high-yield" | "comprehensive" | "granular"`

No internal state — pure controlled component.

## Options

| value | label | description |
|---|---|---|
| `high-yield` | High-Yield | Core concepts & pathways only. |
| `comprehensive` | Comprehensive | Includes secondary details & clinical correlations. |
| `granular` | Granular | PhD-level extraction of all testable facts. |

## Layout

Outer: `inline-grid grid-cols-3 bg-[#f5f3ee] rounded-full p-[3px]` (pill group).
Below: `<p key={value}>` with description text — `key={value}` forces remount on change, triggering `animate-in fade-in duration-200`.

## Style classes

| State | Classes |
|---|---|
| Active button | `bg-white text-[#7a4f0d] shadow-sm` |
| Inactive button | `text-slate-400 hover:text-slate-500` |
| Disabled container | `opacity-40 pointer-events-none` |
| All buttons (base) | `px-5 py-[7px] text-[11px] font-medium tracking-[0.04em] uppercase rounded-full transition-colors duration-150` |

Focus ring: `focus-visible:ring-2 focus-visible:ring-[#c97f1a] focus-visible:ring-offset-1`

Accessibility: container has `role="group" aria-label="Card density"`. Each button has `role="radio"` and `aria-checked`.
