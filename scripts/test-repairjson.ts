// Tests for the extractJson pre-pass that recovers truncated LLM responses.
// Replicates the pre-pass logic from app/api/generate/route.ts so the test
// has no dependency on Next.js route imports.

interface RawCard {
  front: string;
  back: string;
  card_type: string;
  citation: string;
  visual_type?: string;
}

function tryExtract(raw: string): RawCard[] {
  const arrayStart = raw.indexOf("[");
  if (arrayStart !== -1) {
    const slice = raw.slice(arrayStart);
    const lastBrace = slice.lastIndexOf("}");
    if (lastBrace !== -1) {
      try {
        const candidate = slice.slice(0, lastBrace + 1) + "]";
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as RawCard[];
      } catch {
        // fall through
      }
    }
  }
  return [];
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// Input 1: truncated mid-array — two complete objects, missing closing ]
const INPUT1 =
  '[{"front":"What is mitosis?","back":"Cell division producing two daughter cells","card_type":"basic","citation":"p.1","visual_type":"none"},' +
  '{"front":"Define meiosis","back":"Gamete-producing division with two rounds","card_type":"definition","citation":"p.2","visual_type":"none"}';

// Input 2: truncated mid-object — first object complete, second cut off mid-value
const INPUT2 =
  '[{"front":"What is mitosis?","back":"Cell division producing two daughter cells","card_type":"basic","citation":"p.1","visual_type":"none"},' +
  '{"front":"Define meiosis","back":"Gamete';

// Input 3: too truncated to recover any complete object
const INPUT3 = '[{"front":"What';

console.log("=== repairJson pre-pass tests ===\n");

const r1 = tryExtract(INPUT1);
assert(r1.length >= 2, "Input 1: recovers both complete objects", `got ${r1.length} card(s)`);

const r2 = tryExtract(INPUT2);
assert(r2.length >= 1, "Input 2: recovers the first complete object", `got ${r2.length} card(s)`);

const r3 = tryExtract(INPUT3);
assert(r3.length === 0, "Input 3: returns empty array (too truncated)", `got ${r3.length} card(s)`);

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
