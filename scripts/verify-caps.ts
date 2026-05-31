/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * verify-caps.ts — Three-part verification script
 *
 * TEST 1: Tiered character caps — seeds pro:/credit: in Redis (the same keys the
 *                                 webhook writes and route.ts reads) and asserts:
 *                                   free   → capped at 50k  (50,001 chars → 400)
 *                                   Pro    → capped at 300k (50,001 passes, 300,001 → 400)
 *                                   credit → capped at 300k (50,001 passes, 300,001 → 400)
 *                                 The Pro/credit 50,001-char probes pass the cap
 *                                 gate and therefore trigger a real generation.
 * TEST 2: Normal generation     — expects 200 with non-empty blob
 * TEST 3: Rate limit check      — temporarily patches ratelimit.ts to 1/1m,
 *                                 expects first POST → 200, second → 429
 *
 * Requires dev server on localhost:3000.
 */

import * as fs from "fs";
import * as path from "path";
import { Redis } from "@upstash/redis";

const BASE_URL = "http://localhost:3000";

// Load .env.local into process.env (without overwriting already-set vars) so the
// script can authenticate bypass requests (T2) AND seed Redis the same way the
// app does — Redis.fromEnv() reads UPSTASH_REDIS_REST_URL / _TOKEN, which the
// tiered-cap test (T1) needs in order to write pro:/credit: keys.
function loadEnvLocal(): void {
  try {
    const lines = fs.readFileSync(path.resolve(__dirname, "../.env.local"), "utf8").split("\n");
    for (const line of lines) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[m[1]] = val;
    }
  } catch { /* .env.local absent */ }
}
loadEnvLocal();
const BYPASS_TOKEN = process.env.TEST_BYPASS_TOKEN ?? "";
const RATELIMIT_PATH = path.resolve(__dirname, "../app/lib/ratelimit.ts");

const ORIGINAL_LIMIT = `slidingWindow(5, "30 d")`;
const TEST_LIMIT     = `slidingWindow(1, "1 m")`;

// Pulled from test-deck-quality.ts so both scripts agree on sample content.
const SAMPLE_TEXT =
  "The sodium-potassium ATPase pump moves 3 Na+ out and 2 K+ in per " +
  "cycle, consuming 1 ATP. This maintains the resting membrane potential " +
  "of approximately -70mV in neurons. Failure of this pump leads to " +
  "cellular swelling and depolarization. The pump is inhibited by " +
  "ouabain and cardiac glycosides like digoxin. Action potential " +
  "propagation velocity increases with axon diameter and myelination. " +
  "Saltatory conduction between nodes of Ranvier allows speeds up to " +
  "120 m/s in large myelinated fibers.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkServer(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/`);
    return res.status < 500;
  } catch {
    return false;
  }
}

function pass(label: string, detail: string) {
  console.log(`  PASS  ${label} — ${detail}`);
}

function fail(label: string, detail: string) {
  console.log(`  FAIL  ${label} — ${detail}`);
}

// Send `textLength` chars to /api/generate under `identifier` (resolved from
// x-forwarded-for via clientIp, exactly as route.ts does) and report whether the
// route rejected it specifically at the character cap. The route's cap rejection
// is the ONLY 400 carrying { error: "characters" }; anything else (200 blob,
// 422/502/500 from generation, 503 from the global Gemini ceiling) means the
// payload PASSED the cap gate — which is all this test cares about.
async function probeCharCap(
  identifier: string,
  textLength: number
): Promise<{ status: number; charCapRejected: boolean }> {
  const fd = new FormData();
  fd.append("text", "a".repeat(textLength));
  fd.append("density", "high-yield");
  fd.append("style", "standard");

  const res = await fetch(`${BASE_URL}/api/generate`, {
    method: "POST",
    body: fd,
    headers: { "x-forwarded-for": identifier },
  });

  let charCapRejected = false;
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    charCapRejected = body?.error === "characters";
  } else {
    await res.arrayBuffer().catch(() => {}); // drain (a passing probe returns a blob)
  }
  return { status: res.status, charCapRejected };
}

async function test1(): Promise<void> {
  console.log("\n─── TEST 1: Tiered character caps (free 50k · Pro 300k · credit 300k) ───");

  let redis: Redis;
  try {
    redis = Redis.fromEnv();
  } catch (e) {
    fail("T1", `Cannot reach Redis to seed Pro/credit tiers: ${e}`);
    return;
  }

  // Unique per-run identifiers: avoids polluting the free rate-limit bucket and
  // avoids colliding with keys a previous run may have left behind.
  const run = Date.now();
  const freeId = `test-cap-free-${run}`;
  const proId = `test-cap-pro-${run}`;
  const creditId = `test-cap-credit-${run}`;

  // Seed the SAME keys route.ts reads: pro:<id> makes isPro() true (300k cap);
  // credit:<id> > 0 takes the credit branch (300k cap, decremented per gen).
  await redis.set(`pro:${proId}`, "1");
  await redis.set(`credit:${creditId}`, 5);

  try {
    // FREE — must be capped at 50k: 50,001 chars → character-cap 400.
    const free = await probeCharCap(freeId, 50_001);
    if (free.charCapRejected) {
      pass("T1-free", "50,001 chars → character-cap 400 (free capped at 50k) ✓");
    } else {
      fail("T1-free", `50,001 chars → status ${free.status}, NOT a character-cap rejection (free must not exceed 50k)`);
    }

    // PRO — must NOT be capped at 50k, and must be capped at 300k.
    const proAt50k = await probeCharCap(proId, 50_001);
    if (!proAt50k.charCapRejected) {
      pass("T1-pro-50k", `50,001 chars → status ${proAt50k.status}, passed the cap gate (Pro not capped at 50k) ✓`);
    } else {
      fail("T1-pro-50k", "50,001 chars → character-cap 400 (Pro is wrongly capped at 50k)");
    }
    const proAt300k = await probeCharCap(proId, 300_001);
    if (proAt300k.charCapRejected) {
      pass("T1-pro-300k", "300,001 chars → character-cap 400 (Pro cap is 300k) ✓");
    } else {
      fail("T1-pro-300k", `300,001 chars → status ${proAt300k.status}, NOT rejected (Pro cap exceeds 300k)`);
    }

    // CREDIT-BACKED — must NOT be capped at 50k, and must be capped at 300k.
    const creditAt50k = await probeCharCap(creditId, 50_001);
    if (!creditAt50k.charCapRejected) {
      pass("T1-credit-50k", `50,001 chars → status ${creditAt50k.status}, passed the cap gate (credit not capped at 50k) ✓`);
    } else {
      fail("T1-credit-50k", "50,001 chars → character-cap 400 (credit is wrongly capped at 50k)");
    }
    const creditAt300k = await probeCharCap(creditId, 300_001);
    if (creditAt300k.charCapRejected) {
      pass("T1-credit-300k", "300,001 chars → character-cap 400 (credit cap is 300k) ✓");
    } else {
      fail("T1-credit-300k", `300,001 chars → status ${creditAt300k.status}, NOT rejected (credit cap exceeds 300k)`);
    }
  } finally {
    // Remove seeded keys so a later caller reusing the identifier isn't entitled.
    await redis.del(`pro:${proId}`, `credit:${creditId}`).catch(() => {});
  }
}

async function test2(): Promise<void> {
  console.log("\n─── TEST 2: Normal generation (short text → expect 200 + non-empty blob) ───");

  const fd = new FormData();
  fd.append("text", SAMPLE_TEXT);
  fd.append("density", "high-yield");
  fd.append("style", "standard");

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/generate`, {
      method: "POST",
      body: fd,
      headers: {
        "x-forwarded-for": "test-normal-gen",
        ...(BYPASS_TOKEN ? { "x-test-token": BYPASS_TOKEN } : {}),
      },
    });
  } catch (e) {
    fail("T2", `Network error: ${e}`);
    return;
  }

  if (res.status !== 200) {
    const body = await res.text().catch(() => "(unreadable)");
    fail("T2", `status ${res.status} — ${body.slice(0, 200)}`);
    return;
  }

  const blob = await res.blob();
  if (blob.size > 0) {
    pass("T2", `status 200, blob size ${blob.size.toLocaleString()} bytes ✓`);
  } else {
    fail("T2", "status 200 but blob size is 0");
  }
}

async function test3(): Promise<void> {
  console.log("\n─── TEST 3: Rate limit (1/1 m → first 200, second 429) ───");

  // Patch ratelimit.ts
  let original: string;
  try {
    original = fs.readFileSync(RATELIMIT_PATH, "utf8");
  } catch (e) {
    fail("T3", `Could not read ${RATELIMIT_PATH}: ${e}`);
    return;
  }

  if (!original.includes(ORIGINAL_LIMIT)) {
    fail(
      "T3",
      `Expected to find "${ORIGINAL_LIMIT}" in ratelimit.ts — ` +
        `file content has changed; skipping to avoid corruption`
    );
    return;
  }

  const patched = original.replace(ORIGINAL_LIMIT, TEST_LIMIT);
  try {
    fs.writeFileSync(RATELIMIT_PATH, patched, "utf8");
    console.log(`  Patched ratelimit.ts → ${TEST_LIMIT}, waiting 8 s for Next.js hot-reload…`);
    await sleep(8_000);
  } catch (e) {
    fail("T3", `Could not write patched ratelimit.ts: ${e}`);
    return;
  }

  // Use a fresh identifier so prior test requests don't pollute the bucket.
  const id = `test-ratelimit-${Date.now()}`;

  try {
    // First request
    const fd1 = new FormData();
    fd1.append("text", SAMPLE_TEXT);
    fd1.append("density", "high-yield");
    fd1.append("style", "standard");

    const r1 = await fetch(`${BASE_URL}/api/generate`, {
      method: "POST",
      body: fd1,
      headers: { "x-forwarded-for": id },
    });

    if (r1.status === 200) {
      pass("T3-first", `status 200 ✓`);
    } else {
      fail("T3-first", `status ${r1.status} (expected 200)`);
    }

    // Second request — same identifier, limit exhausted
    const fd2 = new FormData();
    fd2.append("text", SAMPLE_TEXT);
    fd2.append("density", "high-yield");
    fd2.append("style", "standard");

    const r2 = await fetch(`${BASE_URL}/api/generate`, {
      method: "POST",
      body: fd2,
      headers: { "x-forwarded-for": id },
    });

    if (r2.status === 429) {
      pass("T3-second", `status 429 ✓`);
    } else {
      fail("T3-second", `status ${r2.status} (expected 429)`);
    }
  } finally {
    // Always revert, even if assertions above throw.
    fs.writeFileSync(RATELIMIT_PATH, original, "utf8");
    console.log(`  Reverted ratelimit.ts → ${ORIGINAL_LIMIT}`);
  }
}

async function diagnosePreconditions(): Promise<{ redisConfigured: boolean }> {
  // Send a minimal POST to /api/generate and see whether we get back a JSON
  // error body (which means the route handler ran) or a blank 500 (which
  // usually means Redis.fromEnv() threw because the credentials are empty).
  try {
    const fd = new FormData();
    fd.append("density", "high-yield");
    fd.append("style", "standard");
    // Deliberately omit "text" so we get a fast 400 if the handler runs.
    const res = await fetch(`${BASE_URL}/api/generate`, {
      method: "POST",
      body: fd,
      headers: { "x-forwarded-for": "precondition-check" },
    });
    const body = await res.text().catch(() => "");
    if (res.status === 400 && body.includes("No text")) {
      return { redisConfigured: true };
    }
    if (res.status === 429) {
      return { redisConfigured: true };
    }
    // Blank 500 → Redis init failed
    if (res.status === 500 && body.trim() === "") {
      return { redisConfigured: false };
    }
    return { redisConfigured: true };
  } catch {
    return { redisConfigured: false };
  }
}

async function main() {
  const up = await checkServer();
  if (!up) {
    console.error(
      "\nWARNING: Dev server is not reachable on localhost:3000.\n" +
        "Start it with: npm run dev\nExiting."
    );
    process.exit(1);
  }
  console.log(`Server OK at ${BASE_URL}\n`);

  const { redisConfigured } = await diagnosePreconditions();
  if (!redisConfigured) {
    console.error(
      "BLOCKED: All requests return a blank HTTP 500 before reaching the route handler.\n" +
        "Root cause: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are empty in .env.local.\n" +
        "The rate-limit check runs first in route.ts, so every request crashes at Redis.fromEnv().\n\n" +
        "Fix: fill in both values in .env.local (create a free Upstash Redis database at upstash.com,\n" +
        "then copy the REST URL and token), restart the dev server, and re-run this script.\n\n" +
        "TEST 1: BLOCKED (tiered cap test needs the route to run and Redis to seed Pro/credit tiers)\n" +
        "TEST 2: BLOCKED (needs working route)\n" +
        "TEST 3: BLOCKED (needs working rate-limit middleware)"
    );
    process.exit(1);
  }

  await test1();
  await test2();
  await test3();

  console.log("\n─── Done ───\n");
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
