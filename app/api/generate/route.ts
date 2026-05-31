import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { GoogleGenAI } from "@google/genai";
import { enrichCards, RawCard } from "@/app/lib/visualEnricher";
import { buildApkg } from "@/app/lib/ankiExport";
import { ratelimit, isPro, redis } from "@/app/lib/ratelimit";
import { clientIp } from "@/app/lib/clientIp";
import { getPostHogClient } from "@/app/lib/posthog-server";
import { trace, context } from "@opentelemetry/api";

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
  back: "CO = HR × SV\\nCO = cardiac output (L/min), HR = heart rate (beats/min), SV = stroke volume (mL/beat)"
Even in granular density mode, every card must be an equation recall card. If you have exhausted all formula-shaped content in the source, stop generating rather than falling back to fact recall, vocabulary, or definition cards — a smaller deck of valid equation cards is correct; an inflated deck of non-formula cards is not.`,
};

const DENSITY_MODIFIERS: Record<string, string> = {
  "high-yield":
    "Extract ONLY the most critical, highly-tested concepts. Prioritize ruthlessly — skip minor details, but do not artificially limit card count. Fill the full target.",
  "comprehensive":
    "Extract core concepts plus secondary supporting details, specific names, mechanisms, and clinical correlations.",
  "granular":
    "Extract every testable fact, statistic, mechanism, and edge-case in the text. Leave nothing out.",
};

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
//
// For a potential closing '"', we peek at the next non-whitespace character:
// if it isn't a structural JSON token (:  ,  }  ]), the '"' must be an
// interior quote and is escaped as \". This heuristic is reliable for
// LLM-generated JSON where every string value is followed by one of those
// structural tokens.
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_\-\s]/gi, "").trim().replace(/\s+/g, "_") || "anki_deck";
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  const realIp = clientIp(req);
  const identifier: string | null = userId ?? realIp;

  // Entitlement tier for this request. Defaults to free (50k cap); raised to
  // 300k for Pro and one-time credit-backed generations. creditReserved gates
  // the refund-on-failure path further down.
  let charCap = 50_000;
  let creditReserved = false;
  const creditKey = `credit:${identifier ?? "anonymous"}`;

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  } else {
    // TEST BYPASS: when TEST_BYPASS_TOKEN is set and the request carries a matching
    // X-Test-Token header, skip rate limiting entirely. TEST_BYPASS_TOKEN must NEVER
    // be added to Vercel production environment variables — dev/CI only.
    const bypassToken = process.env.TEST_BYPASS_TOKEN;
    const bypassRateLimit = bypassToken && req.headers.get("x-test-token") === bypassToken;

    if (bypassRateLimit) {
      // Bypass skips rate limiting and credit reservation; still honor the Pro cap.
      if (await isPro(identifier)) charCap = 300_000;
    } else if (await isPro(identifier)) {
      // 1. Pro: unlimited generations, 300k cap.
      charCap = 300_000;
    } else {
      // 2. Reserve a one-time credit atomically. decr-then-check prevents concurrent
      // overspend; we incr to refund if we over-decremented or a downstream step fails.
      const creditRemaining = await redis.decr(creditKey);
      if (creditRemaining >= 0) {
        // Credit-backed generation: 300k cap, refunded on any downstream failure.
        charCap = 300_000;
        creditReserved = true;
      } else {
        await redis.incr(creditKey); // undo the over-decrement
        // 3. Free tier: 5 generations / 30d, 50k cap.
        const limitKey = identifier ?? "anonymous";
        const { success, limit, remaining, reset } = await ratelimit.limit(limitKey);
        if (!success) {
          return NextResponse.json(
            { error: "Free limit reached", limit, remaining, reset, upgrade: "https://highyield.cards" },
            { status: 429 }
          );
        }
      }
    }
  }

  // A reserved one-time credit must not be burned if generation cannot complete.
  const refundCredit = async () => {
    if (creditReserved) {
      creditReserved = false;
      await redis.incr(creditKey);
    }
  };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    await refundCredit();
    return NextResponse.json({ error: "Service unavailable" }, { status: 500 });
  }

  let documentText: string;
  let deckName: string;
  let densityModifier: string;
  let densityKey = "high-yield";
  let styleModifier: string = STYLE_MODIFIERS["standard"];
  let isPaste = false;

  try {
    const formData = await req.formData();
    const rawDensity = (formData.get("density") as string | null) ?? "high-yield";
    densityKey = rawDensity in DENSITY_MODIFIERS ? rawDensity : "high-yield";
    densityModifier = DENSITY_MODIFIERS[densityKey];

    const rawStyle = (formData.get("style") as string | null) ?? "standard";
    const customPrompt = (formData.get("customPrompt") as string | null)?.trim() ?? "";
    if (rawStyle === "custom" && customPrompt) {
      styleModifier = `CUSTOM CARD FORMAT — follow these instructions exactly, they override all defaults:\n${customPrompt}`;
    } else {
      styleModifier = STYLE_MODIFIERS[rawStyle] ?? STYLE_MODIFIERS["standard"];
    }

    const text = (formData.get("text") as string | null)?.trim();
    if (!text) {
      await refundCredit();
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }
    documentText = text;
    if (documentText.length > charCap) {
      await refundCredit();
      const message =
        charCap === 50_000
          ? "Text exceeds 50,000 character limit (~10 dense pages). Upgrade to Pro for 300,000 characters."
          : `Text exceeds ${charCap.toLocaleString("en-US")} character limit.`;
      return NextResponse.json({ error: "characters", message }, { status: 400 });
    }
    const filenameFromForm = formData.get("filename") as string | null;
    isPaste = !filenameFromForm;
    const baseName = filenameFromForm?.replace(/\.pdf$/i, "") || "pasted_text";
    const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
    deckName = `${baseName} ${ts}`;
  } catch {
    await refundCredit();
    return NextResponse.json({ error: "Failed to read form data" }, { status: 400 });
  }

  let rawCards: RawCard[];
  try {
    const ai = new GoogleGenAI({ apiKey });
    const target = cardTarget(documentText, densityKey);
    const tracer = trace.getTracer("highyield-cards");
    const span = tracer.startSpan("deck_generation", {
      attributes: { "posthog.distinct_id": identifier ?? "anonymous" },
    });
    let response: Awaited<ReturnType<typeof ai.models.generateContent>>;
    try {
      response = await context.with(
        trace.setSpan(context.active(), span),
        () =>
          ai.models.generateContent({
            model: "gemini-2.5-flash",
            config: {
              systemInstruction: buildSystemInstruction(styleModifier, isPaste),
              maxOutputTokens: 8192,
              temperature: 0.4,
            },
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `Generate at least ${target} flashcards from the document below. The target is a minimum floor, not a ceiling — if the document contains more distinct testable concepts, definitions, rules, or facts, keep generating until you have covered them all. Stop only when you have genuinely exhausted the content, not to hit a round number.\n\nFor structured notes, study guides, or bullet-point outlines, treat each named concept, definition, rule, and bullet point as a separate card — do not consolidate multiple distinct facts onto one card.\n\nDENSITY: ${densityModifier}\n\n---\n\n${documentText}`,
                  },
                ],
              },
            ],
          })
      );
    } finally {
      span.end();
    }
    const text = response.text ?? "";
    rawCards = extractJson(text);
  } catch (err) {
    console.error("[generate] Gemini error:", err);
    await refundCredit();
    return NextResponse.json({ error: "Card generation failed. Please try again." }, { status: 502 });
  }

  let cards: Awaited<ReturnType<typeof enrichCards>>;
  try {
    cards = await enrichCards(rawCards);
  } catch (err) {
    console.error("[generate] Enrichment error:", err);
    await refundCredit();
    return NextResponse.json({ error: "Card generation failed. Please try again." }, { status: 500 });
  }

  cards = cards.map((card) => {
    if (card.back == null) return card;
    const rawCitation = (card as { citation?: unknown }).citation;
    const citationStr = typeof rawCitation === "string" ? rawCitation.trim() : "";
    const cleanFront = card.front.replace(/<[^>]*>/g, "");
    const encodedFront = encodeURIComponent(cleanFront.slice(0, 100));
    const flagLink =
      `<a href="https://tally.so/r/NpbkBW?card=${encodedFront}"` +
      ` style="font-size:10px;color:#c97f1a;text-decoration:none;font-family:monospace;">` +
      `⚑ flag</a>`;
    const showCitation = citationStr && citationStr !== "Pasted text";
    const footer = showCitation
      ? `<div style="margin-top:20px;padding-top:8px;border-top:1px solid #f0f0f0;opacity:0.35;display:flex;justify-content:space-between;align-items:center;">` +
        `<span style="font-size:10px;color:#6b7280;font-family:monospace;letter-spacing:0.02em;">${escapeHtml(citationStr)}</span>` +
        flagLink +
        `</div>`
      : `<div style="margin-top:20px;padding-top:8px;border-top:1px solid #f0f0f0;opacity:0.35;display:flex;justify-content:flex-end;align-items:center;">` +
        flagLink +
        `</div>`;
    return { ...card, back: card.back + footer };
  });

  if (cards.length === 0) {
    await refundCredit();
    return NextResponse.json({ error: "No flashcards could be generated from this document" }, { status: 422 });
  }

  let apkgBuffer: Buffer;
  try {
    apkgBuffer = await buildApkg(deckName, cards);
  } catch (err) {
    console.error("[generate] Export error:", err);
    await refundCredit();
    return NextResponse.json({ error: "Export failed. Please try again." }, { status: 500 });
  }

  const isProUser = await isPro(identifier);
  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: identifier ?? "anonymous",
    event: "deck_generated",
    properties: {
      card_count: cards.length,
      density: densityKey,
      source: isPaste ? "text" : "pdf",
      is_pro: isProUser,
    },
  });
  await posthog.shutdown();

  const safeFilename = sanitizeFilename(deckName);
  return new Response(new Uint8Array(apkgBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFilename}.apkg"`,
      "X-Card-Count": String(cards.length),
      "X-Density": densityKey,
      "Access-Control-Expose-Headers": "X-Card-Count, X-Density",
    },
  });
}
