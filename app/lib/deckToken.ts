// Stateless, signed handoff between /api/deck/start and the chunk route (next
// session). /api/deck/start runs every gate exactly once — char cap, chunk
// sanity, and the rate-limit decrement — then mints a token attesting that the
// quota for this deck has already been paid. The chunk route verifies the token
// instead of re-running the limiter, so a multi-chunk deck costs the caller one
// quota slot, not one per chunk.
//
// The token is NOT secret (it carries no sensitive data) but it IS
// tamper-evident: the HMAC binds id/chunks/iat to DECK_TOKEN_SECRET, and the
// 5-minute TTL bounds replay. A client cannot forge a token, inflate its chunk
// count, or reuse an old one past the window.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface DeckTokenPayload {
  id: string;
  chunks: number;
  iat: number; // issued-at, seconds since epoch
}

// 5 minutes. Long enough for a client to stream every chunk of a large deck,
// short enough that a leaked token is useless almost immediately.
const TTL_SECONDS = 300;

function secret(): string {
  const s = process.env.DECK_TOKEN_SECRET;
  if (!s) throw new Error("DECK_TOKEN_SECRET is not set");
  return s;
}

function hmac(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

export function signDeckToken(payload: DeckTokenPayload): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${hmac(payloadB64)}`;
}

export function verifyDeckToken(token: string): DeckTokenPayload | null {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  // Recompute and compare in constant time. timingSafeEqual throws on
  // length mismatch, so guard on length first.
  let expected: string;
  try {
    expected = hmac(payloadB64);
  } catch {
    return null; // secret missing
  }
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

  let payload: DeckTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof payload?.id !== "string" ||
    typeof payload?.chunks !== "number" ||
    typeof payload?.iat !== "number"
  ) {
    return null;
  }
  if (Math.floor(Date.now() / 1000) - payload.iat > TTL_SECONDS) return null;

  return payload;
}
