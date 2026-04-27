import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import pdfParse from "pdf-parse";
import { enrichCards, RawCard } from "@/app/lib/visualEnricher";
import { buildApkg } from "@/app/lib/ankiExport";

const DENSITY_MODIFIERS: Record<string, string> = {
  "high-yield":
    "Be ruthless. Extract ONLY the absolute most critical, highly-tested concepts. If the text is low-density, return as few as 1 to 5 cards. Ignore all minor details.",
  "comprehensive":
    "Extract the core concepts, but also include secondary supporting details, specific enzyme names, and minor clinical correlations.",
  "granular":
    "Extract every single testable fact, statistic, and edge-case mentioned in the text. Leave no medical or biological stone unturned.",
};

const SYSTEM_PROMPT = `You are an expert Anki flashcard author. Given the text of a document, produce a JSON array of flashcard objects. Each object must have exactly these fields:

- "front"       : string  — the question or prompt side of the card
- "back"        : string  — the answer or explanation side of the card
- "card_type"   : string  — one of: "basic", "cloze", "definition", "process", "comparison"
- "citation"    : string  — a short reference to where in the source this fact appears (e.g. "Section 3.2" or "Page 12, para 2")
- "visual_type" : string  — OPTIONAL. One of: "mermaid", "quickchart", or "none". Use "mermaid" when a diagram genuinely clarifies the concept. Use "quickchart" ONLY when the source text contains actual explicit numerical data worth charting (real statistics, percentages, measurements). Omit or use "none" otherwise.
- "visual_data" : string  — Required when visual_type is "mermaid" or "quickchart". For "mermaid", provide raw Mermaid diagram syntax. For "quickchart", provide a valid Chart.js config object as a JSON string.

Rules:
- Output ONLY a raw JSON array. No markdown fences, no commentary, no keys other than those listed.
- Aim for 10–30 cards depending on document length.
- Each "front" must be a focused, atomic question — one concept per card.
- Each "back" must be concise but complete. Write as a natural, fluid sentence or concise phrase — even for multi-part answers.
- Do NOT use Markdown formatting, bullet points, dashes, or bold text in the "back" field. Avoid structured lists entirely.
- NEVER invent numerical data for charts. Only use "quickchart" when real numbers appear in the source text.
- Mermaid diagram type selection:
  • Linear chains or molecular structures (e.g. ATP, DNA) → graph LR with short, clean node labels and no verbose edge labels
  • Hierarchies, taxonomies, classifications → graph TD with concise labels
  • True step-by-step processes with decision points → flowchart TD
  • Component interactions over time → sequenceDiagram
  • Never use top-down layout for things that read naturally left-to-right
  • Keep edge labels to 1–3 words max; omit them entirely if the arrow direction is self-evident
- Mermaid and Chart.js syntax must be valid and self-contained.
- If you cannot extract meaningful content, return an empty array: []`;

function extractJson(raw: string): RawCard[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array found in model response");
  return JSON.parse(match[0]) as RawCard[];
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

  try {
    const formData = await req.formData();
    const rawDensity = (formData.get("density") as string | null) ?? "high-yield";
    densityModifier = DENSITY_MODIFIERS[rawDensity] ?? DENSITY_MODIFIERS["high-yield"];

    const pastedText = (formData.get("text") as string | null)?.trim();

    if (pastedText) {
      // ── Text mode: use pasted content directly ──────────────────────────
      documentText = pastedText;
      deckName = "pasted_text";
    } else {
      // ── PDF mode: parse uploaded file ───────────────────────────────────
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No file or text provided" }, { status: 400 });
      }
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
      }

      deckName = file.name.replace(/\.pdf$/i, "");
      const fileBuffer = Buffer.from(await file.arrayBuffer());

      try {
        const result = await pdfParse(fileBuffer);
        documentText = result.text.trim();
        if (!documentText) {
          return NextResponse.json(
            { error: "PDF appears to contain no extractable text" },
            { status: 422 }
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[pdf-parse] Failed to parse PDF:", message);
        return NextResponse.json({ error: `Failed to parse PDF: ${message}` }, { status: 422 });
      }
    }
  } catch {
    return NextResponse.json({ error: "Failed to read form data" }, { status: 400 });
  }

  let rawCards: RawCard[];
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: SYSTEM_PROMPT },
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
