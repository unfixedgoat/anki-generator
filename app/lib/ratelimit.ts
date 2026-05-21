import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "30 d"),
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
