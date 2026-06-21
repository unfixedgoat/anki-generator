import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { burstLimit } from "@/app/lib/ratelimit";
import { clientIp } from "@/app/lib/clientIp";
import { verifyDeckToken } from "@/app/lib/deckToken";
import { generateChunk } from "@/app/lib/generateChunk";

export const maxDuration = 60;

// Per-chunk generation. The deck quota was already decremented exactly once at
// /api/deck/start, so this route NEVER touches the deck limiter — it only
// verifies the signed token and enforces the burst (Gemini spend) cap.
export async function POST(req: NextRequest) {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  let token: string;
  let chunk: string;
  try {
    const body = (await req.json()) as { token?: unknown; chunk?: unknown };
    if (typeof body.token !== "string" || typeof body.chunk !== "string") {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    token = body.token;
    chunk = body.chunk;
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const payload = verifyDeckToken(token);
  if (!payload) {
    return NextResponse.json({ error: "token" }, { status: 401 });
  }

  // Bind the token to the caller: the identifier resolved server-side (same
  // rightmost-IP logic as every other route) must match the id the token was
  // minted for. A token lifted from another caller is rejected here.
  const { userId } = await auth();
  const identifier: string | null = userId ?? clientIp(req);
  if ((identifier ?? "anonymous") !== payload.id) {
    return NextResponse.json({ error: "token" }, { status: 401 });
  }

  // Spend cap fires BEFORE the Gemini call — this is the dollar fuse.
  const { success } = await burstLimit.limit(identifier ?? "anonymous");
  if (!success) {
    return NextResponse.json({ error: "burst" }, { status: 429 });
  }

  let cards;
  try {
    cards = await generateChunk(chunk);
  } catch (err) {
    console.error("[generate/chunk] Gemini error:", err);
    return NextResponse.json({ error: "Card generation failed. Please try again." }, { status: 502 });
  }

  return NextResponse.json({ cards }, { status: 200 });
}
