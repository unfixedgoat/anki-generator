import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ratelimit, isPro } from "@/app/lib/ratelimit";
import { clientIp } from "@/app/lib/clientIp";
import { signDeckToken } from "@/app/lib/deckToken";

// Pre-flight gate for multi-chunk deck generation. The client calls this once
// before streaming chunks; it runs every spend gate (char cap, chunk sanity,
// rate-limit decrement) here, then hands back a signed token the chunk route
// verifies instead of re-charging quota per chunk. The quota decrement happens
// exactly once — here, never in the chunk route.
export async function POST(req: NextRequest) {
  // Identifier resolution mirrors /api/generate exactly: Clerk userId when
  // signed in, otherwise the trusted client IP. Never read from the body.
  const { userId } = await auth();
  const identifier: string | null = userId ?? clientIp(req);

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  let totalChars: number;
  let chunks: number;
  try {
    const body = (await req.json()) as { totalChars?: unknown; chunks?: unknown };
    totalChars = Number(body.totalChars);
    chunks = Number(body.chunks);
    if (!Number.isFinite(totalChars) || !Number.isFinite(chunks)) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const pro = await isPro(identifier);

  // Char cap gate fires first, so an oversized free document is rejected before
  // any token is issued and never reaches generation.
  const cap = pro ? 300_000 : 50_000;
  if (totalChars > cap) {
    return NextResponse.json({ error: "characters" }, { status: 400 });
  }

  // Chunk sanity cap bounds per-deck Gemini spend regardless of tier.
  if (chunks < 1 || chunks > 40) {
    return NextResponse.json({ error: "chunks" }, { status: 400 });
  }

  // Quota: Pro skips the limiter entirely (mirror /api/generate's Pro bypass).
  // Free tier decrements once here. The shape mirrors /api/generate's 429.
  if (!pro) {
    const limitKey = identifier ?? "anonymous";
    const { success, limit, remaining, reset } = await ratelimit.limit(limitKey);
    if (!success) {
      return NextResponse.json(
        { error: "Free limit reached", limit, remaining, reset, upgrade: "https://highyield.cards" },
        { status: 429 }
      );
    }
  }

  const token = signDeckToken({
    id: identifier ?? "anonymous",
    chunks,
    iat: Math.floor(Date.now() / 1000),
  });
  return NextResponse.json({ token, cap, pro }, { status: 200 });
}
