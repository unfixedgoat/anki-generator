// Single-chunk generation, extracted for the per-chunk fan-out architecture
// (/api/generate/chunk). Each chunk now owns a full Gemini invocation instead
// of sharing one request's token budget with every sibling chunk.
//
// ⚠️ NOTE FOR ANDREW — INTENTIONAL DUPLICATION, TEMPORARY ⚠️
// The system instruction, the user-content prompt template, the JSON repair/
// parse helpers, and cardTarget below are copied VERBATIM from /api/generate's
// route.ts. The old fan-out path is still the live safety net and still owns
// its own copy of these strings. Do NOT edit the prompt in only one of the two
// locations during the migration window or they will silently drift. When the
// old /api/generate path is deleted, this becomes the single source of truth.
//
// The ONLY intentional behavioral change vs. the inlined original is
// maxOutputTokens: 8000 → 65536. With one chunk per invocation there are no
// competing chunks on the clock, so the higher ceiling kills per-chunk
// truncation. That is the entire point of the architecture.
import { GoogleGenAI } from "@google/genai";
import { RawCard } from "@/app/lib/visualEnricher";

// Verbatim from /api/generate route.ts — standard style + high-yield density are
// the defaults this standalone path renders. Keep byte-identical to the live path.
const STANDARD_STYLE_MODIFIER =
  "Generate standard flashcards: focused question on the front, complete sentence answer on the back.";
const HIGH_YIELD_DENSITY_MODIFIER =
  "Extract ONLY the most critical, highly-tested concepts. Prioritize ruthlessly — skip minor details, but do not artificially limit card count. Fill the full target.";

function buildSystemInstruction(styleModifier: string, isPaste: boolean): string {
  const citationInstruction = isPaste
    ? `- "citation"    : string  — use the value "Pasted text" for every card. Do not quote or echo the source sentence.`
    : `- "citation"    : string  — short reference to where in the source this fact appears (e.g. "Section 3.2")`;
  return `You are an expert Anki flashcard author. Produce a JSON array of flashcard objects from the document text provided. Each object must have exactly these fields:

- "front"       : string  — the question or prompt side of the card
- "back"        : string  — the answer or explanation side of the card
- "card_type"   : string  — one of: "basic", "cloze", "definition", "process", "comparison"
${citationInstruction}
- "visual_type" : string  — OPTIONAL. One of: "mermaid", "quickchart", "wikimedia", or "none".
  Ask yourself: would a textbook include a figure here? If yes, pick the right type below.
  Use "wikimedia" when the concept has a real-world referent that Wikipedia would illustrate with a photograph or diagram — regardless of subject. This includes: any named structure, organ, organism, apparatus, instrument, device, cell type, molecule, compound, geographic feature, historical artifact, mathematical object, or physical system. If a student would Google image search it to understand it, use "wikimedia". Examples span all fields: a neuron synapse, the amygdala, a galvanic cell, a DNA double helix, a supply-demand curve, a Venn diagram, a geometric solid, a balance sheet layout, a neurotransmitter receptor, an action potential trace.
  Use "mermaid" when the concept is a process, relationship, hierarchy, or logical flow with no single real-world image — something a textbook would show as a drawn diagram with boxes and arrows. Examples: a signal transduction cascade, the stages of mitosis, Le Chatelier equilibrium shifts, a cognitive-behavioral therapy cycle, a decision tree, a neural pathway, an algorithm flowchart, a market feedback loop, a Krebs cycle, a classification taxonomy.
  Use "quickchart" ONLY when the source text contains actual numerical data worth visualizing as a chart (bar, line, pie). Do not invent numbers.
  Omit or use "none" for simple definitions, vocabulary cards, and facts where a visual adds nothing.
- "visual_data" : string  — Required when visual_type is set. For "wikimedia": write a specific, multi-word academic search term that includes the subject domain to avoid matching films, companies, or disambiguation pages (e.g. "catalysis chemistry enzyme reaction" not "catalyst"; "galvanic electrochemical cell diagram" not "battery"; "synapse neurotransmitter vesicle" not "synapse"; "amygdala brain anatomy" not "amygdala"; "supply demand curve microeconomics" not "supply and demand"). The more specific the term, the more likely Wikipedia returns the correct scientific article. For "mermaid": raw Mermaid syntax. For "quickchart": a Chart.js config JSON string.

CARD FORMAT — this is your primary instruction, follow it exactly:
${styleModifier}

Additional rules:
- Output ONLY a raw JSON array. No markdown fences, no commentary, no extra keys.
- Default formatting when the card format above does not specify: write "back" as a natural sentence or short phrase. No asterisks, bold, italics, bullet points, or dashes.
- Use HTML <sub> and <sup> for chemical formulas and exponents (e.g. H<sub>2</sub>O, Ca<sup>2+</sup>).
- Use Unicode Greek letters and math symbols directly — never spell them out. Examples: Δ not "delta", α not "alpha", β not "beta", μ not "mu", Σ not "sigma", π not "pi", ≈ not "approximately", → not "yields".
- Visual enrichment applies to ALL card styles — evaluate visual_type independently of format.
- Never invent numerical data for charts — only use "quickchart" when real numbers appear in the source. (Exception: Solve mode cards MUST invent realistic practice problem values.)
- Mermaid: linear chains → graph LR; hierarchies → graph TD; processes → flowchart TD; interactions → sequenceDiagram. Keep edge labels ≤3 words.
- If you cannot extract meaningful content, return [].`;
}

function cardTarget(text: string, density: string): number {
  const words = text.trim().split(/\s+/).length;
  // Thresholds are intentionally aggressive — structured study guides and
  // bullet-point notes pack far more distinct testable facts per word than
  // prose. Better to ask for more and let Gemini stop at natural saturation
  // than to cap too low and miss half the content.
  let base: number;
  if (words < 300)        base = 10;
  else if (words < 800)   base = 20;
  else if (words < 2000)  base = 40;
  else if (words < 5000)  base = 65;
  else if (words < 10000) base = 100;
  else if (words < 20000) base = 140;
  else                    base = 180;

  const multiplier = density === "high-yield" ? 0.5 : density === "granular" ? 1.5 : 1.0;
  return Math.round(base * multiplier);
}

function stripMarkdown(text: string): string {
  return text.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1").replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
}

// Gemini sometimes emits malformed JSON string values: literal control
// characters (0x00–0x1F) instead of escape sequences, and unescaped double
// quotes inside strings (e.g. quoting text or notation). This scanner fixes
// both while leaving structural JSON tokens untouched.
function repairJson(str: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      if (!inString) {
        inString = true;
        out += ch;
        continue;
      }
      // Lookahead: find next non-whitespace character.
      let j = i + 1;
      while (j < str.length && " \t\r\n".includes(str[j])) j++;
      const next = j < str.length ? str[j] : "";
      if (next === "" || next === ":" || next === "," || next === "}" || next === "]") {
        inString = false;
        out += ch;
      } else {
        out += '\\"';
      }
      continue;
    }
    if (inString) {
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        if (ch === "\n") { out += "\\n"; continue; }
        if (ch === "\r") { out += "\\r"; continue; }
        if (ch === "\t") { out += "\\t"; continue; }
        out += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function extractJson(raw: string): RawCard[] {
  // Pre-pass: recover truncated arrays (missing closing ]) by finding the last }
  // and appending ]. Runs before the regex match so it handles responses that were
  // cut off mid-stream without a closing bracket.
  const arrayStart = raw.indexOf("[");
  if (arrayStart !== -1) {
    const slice = raw.slice(arrayStart);
    const lastBrace = slice.lastIndexOf("}");
    if (lastBrace !== -1) {
      try {
        const candidate = slice.slice(0, lastBrace + 1) + "]";
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return (parsed as RawCard[]).map(c => ({ ...c, front: stripMarkdown(c.front), back: stripMarkdown(c.back) }));
        }
      } catch {
        // fall through to existing tiers
      }
    }
  }

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array found in model response");
  const jsonStr = match[0];
  let cards: RawCard[];
  try {
    cards = JSON.parse(jsonStr) as RawCard[];
  } catch (originalErr) {
    try {
      cards = JSON.parse(repairJson(jsonStr)) as RawCard[];
    } catch {
      try {
        const truncated = jsonStr.slice(0, jsonStr.lastIndexOf("}") + 1) + "]";
        cards = JSON.parse(repairJson(truncated)) as RawCard[];
      } catch {
        throw originalErr;
      }
    }
  }
  return cards.map(c => ({ ...c, front: stripMarkdown(c.front), back: stripMarkdown(c.back) }));
}

// Single-chunk generation. The prompt content below is byte-identical to the
// inlined generateChunk helper in /api/generate (standard style, high-yield
// density defaults). maxOutputTokens is the one deliberate change: 65536.
export async function generateChunk(chunk: string): Promise<RawCard[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey });

  const styleModifier = STANDARD_STYLE_MODIFIER;
  const densityModifier = HIGH_YIELD_DENSITY_MODIFIER;
  const isPaste = false;
  const target = cardTarget(chunk, "high-yield");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    config: {
      systemInstruction: buildSystemInstruction(styleModifier, isPaste),
      maxOutputTokens: 65536,
      temperature: 0.4,
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Generate at least ${target} flashcards from the document below. The target is a minimum floor, not a ceiling — if the document contains more distinct testable concepts, definitions, rules, or facts, keep generating until you have covered them all. Stop only when you have genuinely exhausted the content, not to hit a round number.\n\nFor structured notes, study guides, or bullet-point outlines, treat each named concept, definition, rule, and bullet point as a separate card — do not consolidate multiple distinct facts onto one card.\n\nDENSITY: ${densityModifier}\n\n---\n\n${chunk}`,
          },
        ],
      },
    ],
  });
  return extractJson(response.text ?? "");
}
