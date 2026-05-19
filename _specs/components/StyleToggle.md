# StyleToggle component

`app/components/StyleToggle.tsx`

## Props

```ts
interface Props {
  value: CardStyle;                    // controlled value
  onChange: (value: CardStyle) => void;
  disabled?: boolean;                  // defaults to false
}
```

`CardStyle` (exported): `"standard" | "cloze" | "concise" | "essay" | "mcq" | "solve" | "formula" | "custom"`

No internal state — pure controlled component.

## Options (8 total)

| value | label | subtitle |
|---|---|---|
| `standard` | Standard | Q&A sentence |
| `cloze` | Cloze | Fill in blank |
| `concise` | Concise | Short answer |
| `essay` | Essay | Long form |
| `mcq` | MCQ | 4 choices |
| `solve` | Solve | Step by step |
| `formula` | Formula | Math & chem |
| `custom` | Custom | Your prompt |

## Grid layout

`grid grid-cols-4 gap-[5px]` — 8 items in a 4-column grid = 2 rows.

## Style classes

| State | Classes |
|---|---|
| Active button | `border-[#c97f1a] text-[#7a4f0d] bg-[#fef8ee] font-medium` |
| Inactive button | `border-slate-200 bg-white text-slate-600` |
| Disabled container | `opacity-40 pointer-events-none` |
| All buttons (base) | `rounded-lg border px-2 py-1.5 text-center cursor-pointer text-[11px] transition-colors duration-150` |

Each button renders two `<p>` tags: label at 11px and subtitle at 9px. Active subtitle: `text-[#c97f1a]`. Inactive subtitle: `text-slate-400`.

Focus ring: `focus-visible:ring-2 focus-visible:ring-[#c97f1a] focus-visible:ring-offset-1`

Accessibility: container has `role="group" aria-label="Card style"`. Each button has `role="radio"` and `aria-checked`.

## Integration note

When `value === "custom"`, `DropZone` renders a `<textarea>` below `StyleToggle` for the custom prompt. `StyleToggle` itself has no awareness of this; the conditional is in `DropZone`.
