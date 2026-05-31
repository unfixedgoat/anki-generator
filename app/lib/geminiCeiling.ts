import { redis } from "@/app/lib/ratelimit";

// Global daily circuit breaker for Gemini usage. A single UTC-date-stamped
// counter, shared across ALL routes / users / IPs: once the day's total call
// count exceeds GEMINI_DAILY_CEILING, every caller is refused for the rest of
// the day. This protects against a leaked GEMINI_API_KEY and against distributed
// abuse spread across many IPs that never trips any per-user limit.
//
// Call-count based: each generateContent invocation counts as 1. It can be made
// token-based later by INCRBY estimated-tokens instead of INCR (and scaling
// GEMINI_DAILY_CEILING accordingly).
export async function reserveGeminiCall(): Promise<boolean> {
  // UTC date stamp auto-resets the counter each day and self-cleans via TTL.
  const key = `gemini:calls:${new Date().toISOString().slice(0, 10)}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 172800); // 2-day TTL, set once on creation
  const ceiling = Number(process.env.GEMINI_DAILY_CEILING ?? "1000");
  // INCR-then-compare (not check-then-incr) so concurrent callers can't race
  // past the ceiling. A tripped breaker stays tripped for the day — never
  // refund, even on downstream failure; minor overshoot on a trip is acceptable.
  return n <= ceiling;
}
