/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * verify-caps.ts — Three-part verification script
 *
 * TEST 1: Character cap check — expects 400 for 51,000-char input
 * TEST 2: Normal generation   — expects 200 with non-empty blob
 * TEST 3: Rate limit check    — temporarily patches ratelimit.ts to 1/1m,
 *                               expects first POST → 200, second → 429
 *
 * Requires dev server on localhost:3000.
 */

import * as fs from "fs";
import * as path from "path";

const BASE_URL = "http://localhost:3000";
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

async function test1(): Promise<void> {
  console.log("\n─── TEST 1: Character cap check (51,000-char input → expect 400) ───");

  const bigText = "a".repeat(51_000);
  const fd = new FormData();
  fd.append("text", bigText);
  fd.append("density", "high-yield");
  fd.append("style", "standard");

  let status: number;
  try {
    // Use a unique identifier so this test never hits a lingering rate-limit bucket.
    const res = await fetch(`${BASE_URL}/api/generate`, {
      method: "POST",
      body: fd,
      headers: { "x-forwarded-for": "test-cap-check" },
    });
    status = res.status;
  } catch (e) {
    fail("T1", `Network error: ${e}`);
    return;
  }

  if (status !== 200) {
    pass("T1", `status ${status} — not 200 ✓`);
  } else {
    fail(
      "T1",
      `status 200 — no character cap is enforced in route.ts; ` +
        `add a length guard (e.g. text.length > 50_000 → 400) to make this pass`
    );
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
      headers: { "x-forwarded-for": "test-normal-gen" },
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
    console.log(`  Patched ratelimit.ts → ${TEST_LIMIT}, waiting 4 s for Next.js hot-reload…`);
    await sleep(4_000);
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
        "TEST 1: BLOCKED (would need route to run; also no character cap exists in route.ts)\n" +
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
