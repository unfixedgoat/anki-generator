import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { enrichCards, RawCard } from "@/app/lib/visualEnricher";
import { buildApkg } from "@/app/lib/ankiExport";

const STYLE_MODIFIERS: Record<string, string> = {
  "standard":
    "STYLE: Standard. Generate standard flashcards: focused question on the front, complete sentence answer on the back.",
  "cloze":
    "STYLE: Cloze. OVERRIDE default prose rule: the front MUST be a complete sentence with the key term replaced by ___ (three underscores). The back reveals the missing term followed by a brief one-sentence explanation. The blank ___ is required — do not write out the term on the front.",
  "concise":
    "STYLE: Concise. The back must be a single word or very short phrase — never more than 5 words. The front must be specific enough that one short answer suffices.",
  "essay":
    "STYLE: Essay. Generate cards requiring deep, multi-sentence answers. The front must ask 'explain', 'describe the mechanism of', or 'compare and contrast'. The back must be thorough and multi-sentence.",
  "mcq":
    "STYLE: Multiple Choice. OVERRIDE default prose rule: the front MUST contain the question text, then a blank line, then exactly four answer options each on its own line formatted exactly as: A) [option text], B) [option text], C) [option text], D) [option text]. The back must state the correct letter (e.g. 'B'), the full answer text, and a one-sentence explanation. Use newline characters (\\n) to separate lines within the front and back strings. Do NOT collapse the options into a single sentence.",
  "solve":
    "STYLE: Solve. OVERRIDE default prose rule: the front presents a quantitative practice problem with realistic numerical values and asks to solve for one variable. The back shows the full worked solution with every step on its own line, correct units throughout, and the final numerical answer clearly stated. Use \\n to separate steps. You may use reasonable textbook-style values if the source contains none.",
  "formula":
    "STYLE: Formula. The front asks 'What is the equation for [concept]?' The back states the equation using plain-text notation (e.g. 'F = ma', 'PV = nRT'), then on the next line defines each variable. Use \\n to separate the equation from the variable definitions.",
};

const DENSITY_MODIFIERS: Record<string, string> = {
  "high-yield":
    "Extract ONLY the most critical, highly-tested concepts. Prioritize ruthlessly — skip minor details, but do not artificially limit card count. Fill the full target.",
  "comprehensive":
    "Extract core concepts plus secondary supporting details, specific names, mechanisms, and clinical correlations.",
  "granular":
    "Extract every testable fact, statistic, mechanism, and edge-case in the text. Leave nothing out.",
};

function buildSystemPrompt(cardTarget: number, styleModifier: string): string {
  return `You are an expert Anki flashcard author. Given the text of a document, produce a JSON array of flashcard objects. Each object must have exactly these fields:

- "front"       : string  — the question or prompt side of the card
- "back"        : string  — the answer or explanation side of the card
- "card_type"   : string  — one of: "basic", "cloze", "definition", "process", "comparison"
- "citation"    : string  — a short reference to where in the source this fact appears (e.g. "Section 3.2" or "Page 12, para 2")
- "visual_type" : string  — OPTIONAL. One of: "mermaid", "quickchart", "wikimedia", or "none". Use "wikimedia" for anatomical structures, organ systems, or real-world biological entities that benefit from a textbook-accurate image (e.g. cell organelles, anatomical diagrams, molecular structures). Use "mermaid" for abstract processes, pathways, and relationships best shown as a diagram. Use "quickchart" ONLY when the source text contains actual explicit numerical data. Omit or use "none" otherwise.
- "visual_data" : string  — Required when visual_type is set. For "wikimedia", provide a highly specific Wikipedia image search term (e.g. "Circle of Willis diagram", "Mitochondria structure", "Phospholipid bilayer"). For "mermaid", provide raw Mermaid diagram syntax. For "quickchart", provide a valid Chart.js config object as a JSON string.

CARD STYLE — follow this exactly, it overrides all other formatting rules:
${styleModifier}

Rules:
- Output ONLY a raw JSON array. No markdown fences, no commentary, no keys other than those listed.
- Target approximately ${cardTarget} cards. This is calibrated to the document length — hit it.
- Each "front" must be a focused, atomic question — one concept per card.
- Default formatting (apply ONLY when the card style above does not specify otherwise): write "back" as a natural, fluid sentence or concise phrase. No Markdown, asterisks, bold, italics, bullet points, or dashes. Plain prose only.
- Use HTML <sub> and <sup> tags for chemical formulas, ion charges, and exponents (e.g. H<sub>2</sub>O, Ca<sup>2+</sup>, CO<sub>2</sub>). Write equations in plain prose (e.g. "delta G equals negative RT ln K") unless the card style above requires a specific equation format.
- Visual enrichment applies to ALL card styles. Always evaluate visual_type independently of front/back format — an MCQ or formula card can still have a diagram or Wikimedia image.
- NEVER invent numerical data for charts. Only use "quickchart" when real numbers appear in the source text.
- Mermaid diagram type selection:
  • Linear chains or molecular structures → graph LR with short node labels, no verbose edge labels
  • Hierarchies, taxonomies, classifications → graph TD with concise labels
  • Step-by-step processes with decision points → flowchart TD
  • Component interactions over time → sequenceDiagram
  • Keep edge labels to 1–3 words max; omit if arrow direction is self-evident
- Mermaid and Chart.js syntax must be valid and self-contained.
- If you cannot extract meaningful content, return an empty array: []`;
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
    deckName = (formData.get("filename") as string | null)?.replace(/\.pdf$/i, "") || "pasted_text";
  } catch {
    return NextResponse.json({ error: "Failed to read form data" }, { status: 400 });
  }

  let rawCards: RawCard[];
  try {
    const ai = new GoogleGenAI({ apiKey });
    const target = cardTarget(documentText, densityKey);
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: buildSystemPrompt(target, styleModifier) },
            { text: `\n\nDENSITY INSTRUCTION: ${densityModifier}` },
            { text: `\n\n---\n\nDOCUMENT TEXT:\n\n${documentText}` },
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

  const cards = await enrichCards(rawCards);
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
