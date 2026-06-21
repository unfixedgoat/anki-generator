import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const redis = Redis.fromEnv();

export const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "30 d"),
});

// Per-identifier Gemini spend cap for the per-chunk fan-out path
// (/api/generate/chunk). 50 chunk requests / 60s / IP comfortably clears a
// legitimate 40-chunk deck while stopping a runaway loop from burning dollars.
// This number is the fuse — tune it as real usage data comes in.
export const burstLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(50, "60 s"),
});

export async function isPro(identifier: string | null): Promise<boolean> {
  if (!identifier) return false;
  try {
    const val = await redis.get(`pro:${identifier}`);
    return val !== null;
  } catch {
    return false;
  }
}
