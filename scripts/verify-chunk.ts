import { chunkText } from "../app/lib/chunkText";

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// --- helpers ---

function loremSentence(n: number): string {
  const words = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur",
    "adipiscing", "elit", "sed", "do", "eiusmod", "tempor", "incididunt",
    "ut", "labore", "et", "dolore", "magna", "aliqua"];
  return Array.from({ length: n }, (_, i) => words[i % words.length]).join(" ");
}

/** Build a realistic multi-paragraph text of approximately `chars` chars. */
function makeParagraphText(chars: number): string {
  const paraTarget = 400; // ~400 chars per paragraph
  const paras: string[] = [];
  let total = 0;
  while (total < chars) {
    const sentence = loremSentence(30) + ". " + loremSentence(30) + ". " + loremSentence(30) + ".";
    paras.push(sentence);
    total += sentence.length + 2; // +2 for \n\n
  }
  return paras.join("\n\n");
}

/** Single paragraph (no \n\n), approximately `chars` chars. */
function makeSingleParagraph(chars: number): string {
  const words = ["word"];
  let s = "";
  while (s.length < chars) {
    s += (s ? " " : "") + "word" + s.length;
  }
  return s;
}

console.log("\n=== chunkText verification ===\n");

// Test 1: 5k input → single chunk equal to input
{
  console.log("Test 1: 5k input returns exactly one chunk equal to input");
  const input = makeParagraphText(5000);
  const chunks = chunkText(input);
  assert("returns exactly 1 chunk", chunks.length === 1, `got ${chunks.length}`);
  assert("chunk equals input", chunks[0] === input);
}

// Test 2: 98k input → ~4 chunks, each ≤ ~28750 chars (targetSize * 1.15 = 28750)
{
  console.log("\nTest 2: 98k input → ~4 chunks each ≤ 28750 chars");
  const input = makeParagraphText(98000);
  const chunks = chunkText(input);
  const maxAllowed = Math.floor(25000 * 1.15);
  assert(
    `chunk count is ~4 (got ${chunks.length})`,
    chunks.length >= 3 && chunks.length <= 6,
    `got ${chunks.length}`
  );
  const oversized = chunks.filter((c) => c.length > maxAllowed);
  assert(
    `all chunks ≤ ${maxAllowed} chars`,
    oversized.length === 0,
    oversized.map((c) => c.length).join(", ")
  );
}

// Test 3: concatenated chunks preserve every non-whitespace character
{
  console.log("\nTest 3: concatenated chunks preserve every non-whitespace character");
  const input = makeParagraphText(60000);
  const chunks = chunkText(input);
  const originalNW = input.replace(/\s/g, "");
  const rebuiltNW = chunks.join("").replace(/\s/g, "");
  assert(
    "no non-whitespace content dropped",
    originalNW === rebuiltNW,
    `original=${originalNW.length} rebuilt=${rebuiltNW.length}`
  );
}

// Test 4: no chunk is empty
{
  console.log("\nTest 4: no chunk is empty");
  const input = makeParagraphText(50000);
  const chunks = chunkText(input);
  const empties = chunks.filter((c) => c === "");
  assert("no empty chunks", empties.length === 0, `got ${empties.length} empty`);
}

// Test 5: single 30k-char paragraph with no breaks still splits
{
  console.log("\nTest 5: single 30k-char paragraph (no \\n\\n) still splits");
  const input = makeSingleParagraph(30000);
  const chunks = chunkText(input);
  const maxAllowed = Math.floor(25000 * 1.15);
  assert(
    `returns more than 1 chunk (got ${chunks.length})`,
    chunks.length > 1,
    `got ${chunks.length}`
  );
  const oversized = chunks.filter((c) => c.length > maxAllowed);
  assert(
    `all chunks ≤ ${maxAllowed} chars`,
    oversized.length === 0,
    oversized.map((c) => c.length).join(", ")
  );
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
