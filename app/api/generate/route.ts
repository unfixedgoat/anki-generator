import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { enrichCards, RawCard } from "@/app/lib/visualEnricher";
import { buildApkg } from "@/app/lib/ankiExport";

export const maxDuration = 60;

const STYLE_MODIFIERS: Record<string, string> = {
  "standard":
    "Generate standard flashcards: focused question on the front, complete sentence answer on the back.",
  "cloze":
    `Generate cloze (fill-in-the-blank) cards. The front MUST be a complete sentence with the key term replaced by ___ (three underscores). The back reveals the missing term and briefly explains it. Never write the term on the front.
Example:
  front: "The ___ is the powerhouse of the cell."
  back: "mitochondrion — an organelle that produces ATP via oxidative phosphorylation."`,
  "concise":
    "Generate cards where the back is a single word or very short phrase — never more than 5 words. The front must be specific enough that one short answer suffices.",
  "essay":
    "Generate cards requiring deep, multi-sentence answers. The front must ask 'explain', 'describe the mechanism of', or 'compare and contrast'. The back must be thorough and multi-sentence.",
  "mcq":
    `Generate multiple-choice cards. Every single card MUST follow this exact format — no exceptions.
The "front" field: question text, then a newline character, then exactly four options each on its own line labeled A), B), C), D).
The "back" field: the correct letter, the answer text, and a one-sentence explanation.
All four options must be plausible; only one is correct.

Required JSON format example:
  "front": "Which hormone is produced in excess in Congenital Adrenal Hyperplasia?\\nA) Estrogen\\nB) Cortisol\\nC) Androgens\\nD) Insulin",
  "back": "C) Androgens — CAH causes a cortisol synthesis defect that shunts precursors into androgen production."

You MUST produce this four-option format for every card. Do NOT generate plain Q&A cards.`,
  "solve":
    `Generate worked practice problem cards. EVERY card in the output must be a quantitative word problem with a step-by-step numerical solution. Zero exceptions. If you are about to write a definition, a concept explanation, or any card without numbers — stop and rewrite it as a calculation problem instead.

Required JSON format — every card must match this pattern exactly:
  "front": "A 70 kg patient is given 0.1 mg/kg of epinephrine IV. What is the total dose in mg?"
  "back": "Total dose = 0.1 mg/kg × 70 kg = 7 mg"

  "front": "A reaction has ΔH = −50 kJ/mol and ΔS = −150 J/mol·K. What is the crossover temperature in Kelvin?"
  "back": "Tcrossover = ΔH / ΔS\\nConvert ΔH: −50 kJ/mol = −50,000 J/mol\\nTcrossover = −50,000 / −150 = 333 K"

  "front": "A neuron has Vm = −70 mV and E_K = −90 mV. What is the driving force on K⁺?"
  "back": "Driving force = Vm − E_K = −70 − (−90) = +20 mV (outward)"

Mandatory rules:
- Invent realistic numerical values for EVERY card — the source document does not need to contain numbers
- Front: word problem with invented numbers, asks to solve for exactly one unknown
- Back: labeled equation → substitution → answer with units, each step on its own line (use \\n)
- If a concept seems non-quantitative, find the formula that governs it and build a calculation around that formula
- Do NOT generate any standard Q&A, definition, or explanation cards — the entire deck must be calculation problems`,
  "formula":
    `Generate equation recall cards. The front asks "What is the equation for [concept]?". The back states the equation in plain-text notation, then defines each variable on the next line.
Example:
  front: "What is the equation for cardiac output?"
  back: "CO = HR × SV\\nCO = cardiac output (L/min), HR = heart rate (beats/min), SV = stroke volume (mL/beat)"`,
};

const DENSITY_MODIFIERS: Record<string, string> = {
  "high-yield":
    "Extract ONLY the most critical, highly-tested concepts. Prioritize ruthlessly — skip minor details, but do not artificially limit card count. Fill the full target.",
  "comprehensive":
    "Extract core concepts plus secondary supporting details, specific names, mechanisms, and clinical correlations.",
  "granular":
    "Extract every testable fact, statistic, mechanism, and edge-case in the text. Leave nothing out.",
};

function buildSystemInstruction(styleModifier: string): string {
  return `You are an expert Anki flashcard author. Produce a JSON array of flashcard objects from the document text provided. Each object must have exactly these fields:

- "front"       : string  — the question or prompt side of the card
- "back"        : string  — the answer or explanation side of the card
- "card_type"   : string  — one of: "basic", "cloze", "definition", "process", "comparison"
- "citation"    : string  — short reference to where in the source this fact appears (e.g. "Section 3.2")
- "visual_type" : string  — OPTIONAL. One of: "mermaid", "quickchart", "wikimedia", or "none". Use "wikimedia" for anatomical structures or real-world biological entities. Use "mermaid" for abstract processes and relationships. Use "quickchart" ONLY when the source contains actual numerical data. Omit or use "none" otherwise.
- "visual_data" : string  — Required when visual_type is set. For "wikimedia": a specific image search term. For "mermaid": raw Mermaid syntax. For "quickchart": a Chart.js config JSON string.

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
  // Base target scales with document size
  let base: number;
  if (words < 500)       base = 10;
  else if (words < 2000) base = 20;
  else if (words < 5000) base = 40;
  else if (words < 10000) base = 70;
  else if (words < 20000) base = 110;
  else                   base = 150;

  const multiplier = density === "high-yield" ? 0.5 : density === "granular" ? 1.4 : 1.0;
  return Math.round(base * multiplier);
}

function stripMarkdown(text: string): string {
  return text.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1").replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
}

function extractJson(raw: string): RawCard[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array found in model response");
  const cards = JSON.parse(match[0]) as RawCard[];
  return cards.map(c => ({ ...c, front: stripMarkdown(c.front), back: stripMarkdown(c.back) }));
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_\-\s]/gi, "").trim().replace(/\s+/g, "_") || "anki_deck";
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not set" }, { status: 500 });
  }

  let documentText: string;
  let deckName: string;
  let densityModifier: string;
  let densityKey = "high-yield";
  let styleModifier: string = STYLE_MODIFIERS["standard"];

  try {
    const formData = await req.formData();
    const rawDensity = (formData.get("density") as string | null) ?? "high-yield";
    densityKey = rawDensity in DENSITY_MODIFIERS ? rawDensity : "high-yield";
    densityModifier = DENSITY_MODIFIERS[densityKey];

    const rawStyle = (formData.get("style") as string | null) ?? "standard";
    styleModifier = STYLE_MODIFIERS[rawStyle] ?? STYLE_MODIFIERS["standard"];

    const text = (formData.get("text") as string | null)?.trim();
    if (!text) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }
    documentText = text;
    const baseName = (formData.get("filename") as string | null)?.replace(/\.pdf$/i, "") || "pasted_text";
    const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
    deckName = `${baseName} ${ts}`;
  } catch {
    return NextResponse.json({ error: "Failed to read form data" }, { status: 400 });
  }

  let rawCards: RawCard[];
  try {
    const ai = new GoogleGenAI({ apiKey });
    const target = cardTarget(documentText, densityKey);
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: buildSystemInstruction(styleModifier),
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Generate approximately ${target} flashcards from the document below.\n\nDENSITY: ${densityModifier}\n\n---\n\n${documentText}`,
            },
          ],
        },
      ],
    });
    const text = response.text ?? "";
    rawCards = extractJson(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Gemini request failed: ${message}` }, { status: 502 });
  }

  let cards: Awaited<ReturnType<typeof enrichCards>>;
  try {
    cards = await enrichCards(rawCards);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Visual enrichment failed: ${message}` }, { status: 500 });
  }

  if (cards.length === 0) {
    return NextResponse.json({ error: "No flashcards could be generated from this document" }, { status: 422 });
  }

  let apkgBuffer: Buffer;
  try {
    apkgBuffer = await buildApkg(deckName, cards);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Anki export failed: ${message}` }, { status: 500 });
  }

  const safeFilename = sanitizeFilename(deckName);
  return new Response(new Uint8Array(apkgBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFilename}.apkg"`,
    },
  });
}
