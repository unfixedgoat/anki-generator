import { NextRequest, NextResponse } from "next/server";
import { enrichCards, RawCard } from "@/app/lib/visualEnricher";
import { buildApkg } from "@/app/lib/ankiExport";
import { verifyDeckToken } from "@/app/lib/deckToken";

export const maxDuration = 60;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_\-\s]/gi, "").trim().replace(/\s+/g, "_") || "anki_deck";
}

// Terminal step of the per-chunk pipeline: takes the accumulated cards the
// client gathered from /api/generate/chunk, enriches visuals, and builds the
// .apkg. Token verification gates this against anonymous DoS of the (CPU-heavy)
// sql.js build path — no token, no build.
export async function POST(req: NextRequest) {
  let token: string;
  let deckName: string;
  let cards: RawCard[];
  let density: string;
  try {
    const body = (await req.json()) as {
      token?: unknown;
      deckName?: unknown;
      cards?: unknown;
      style?: unknown;
      density?: unknown;
    };
    if (
      typeof body.token !== "string" ||
      typeof body.deckName !== "string" ||
      !Array.isArray(body.cards)
    ) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    token = body.token;
    deckName = body.deckName;
    cards = body.cards as RawCard[];
    // style is accepted in the body for forward-compat with the client, but
    // buildApkg's existing signature takes only (deckName, cards), so it is not
    // forwarded. density is surfaced only on the X-Density response header to
    // mirror /api/generate.
    density = typeof body.density === "string" ? body.density : "high-yield";
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  if (!verifyDeckToken(token)) {
    return NextResponse.json({ error: "token" }, { status: 401 });
  }

  let enriched: Awaited<ReturnType<typeof enrichCards>>;
  try {
    enriched = await enrichCards(cards);
  } catch (err) {
    console.error("[finalize] Enrichment error:", err);
    return NextResponse.json({ error: "Card generation failed. Please try again." }, { status: 500 });
  }

  if (enriched.length === 0) {
    return NextResponse.json({ error: "No flashcards could be generated from this document" }, { status: 422 });
  }

  let apkgBuffer: Buffer;
  try {
    apkgBuffer = await buildApkg(deckName, enriched);
  } catch (err) {
    console.error("[finalize] Export error:", err);
    return NextResponse.json({ error: "Export failed. Please try again." }, { status: 500 });
  }

  const safeFilename = sanitizeFilename(deckName);
  return new Response(new Uint8Array(apkgBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFilename}.apkg"`,
      "X-Card-Count": String(enriched.length),
      "X-Density": density,
      "Access-Control-Expose-Headers": "X-Card-Count, X-Density",
    },
  });
}
