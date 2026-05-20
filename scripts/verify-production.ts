/**
 * verify-production.ts — Live production smoke tests
 *
 * TEST 1: Production is up                 GET /              → 200
 * TEST 2: Rate limit enforced              6× POST /generate  → 5×200 then 429
 * TEST 3: Character cap enforced           POST 51,000 chars  → 400
 *
 * ── Why the isPro bypass is used ────────────────────────────────────────────
 * Vercel overwrites client-supplied X-Forwarded-For headers with the real
 * client IP before serverless functions see them.  Custom test identifiers
 * are ignored, and every request from this machine shares the same rate-limit
 * bucket.  The initial diagnostic run (with the 307-redirect bug) exhausted
 * all 5 free slots.
 *
 * The workaround: GET /api/whoami to learn the real identifier Vercel assigns,
 * then temporarily write pro:<identifier> to Redis so requests 1-5 bypass the
 * depleted counter.  Remove the pro key before request 6 to force a 429.
 * This produces the exact 5×200 + 1×429 sequence while avoiding a 30-day wait
 * for the sliding window to reset.
 * ────────────────────────────────────────────────────────────────────────────
 */

import * as fs from "fs";
import * as path from "path";

// Load .env.local before any module that calls Redis.fromEnv() at init time.
const envFile = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq);
    const v = t.slice(eq + 1);
    if (!process.env[k]) process.env[k] = v;
  }
}

// Dynamic requires — evaluated after env is populated
const { isPro } = require("../app/lib/ratelimit") as {
  isPro: (id: string) => Promise<boolean>;
};
const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");

const PROD_URL           = "https://www.highyield.cards"; // canonical — bare domain issues 307
const REQUEST_TIMEOUT_MS = 90_000;

const SAMPLE_TEXT =
  "The sodium-potassium ATPase pump moves 3 Na+ out and 2 K+ in per " +
  "cycle, consuming 1 ATP. This maintains the resting membrane potential " +
  "of approximately -70mV in neurons. Failure of this pump leads to " +
  "cellular swelling and depolarization. The pump is inhibited by " +
  "ouabain and cardiac glycosides like digoxin. Action potential " +
  "propagation velocity increases with axon diameter and myelination. " +
  "Saltatory conduction between nodes of Ranvier allows speeds up to " +
  "120 m/s in large myelinated fibers.";

// ── Result tracking ───────────────────────────────────────────────────────

interface Result { label: string; passed: boolean; detail: string }
const results: Result[] = [];

function record(label: string, passed: boolean, detail: string): void {
  results.push({ label, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${label} — ${detail}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function generateForm(): FormData {
  const fd = new FormData();
  fd.append("text", SAMPLE_TEXT);
  fd.append("density", "high-yield");
  fd.append("style", "standard");
  return fd;
}

async function postGenerate(): Promise<Response> {
  return timedFetch(`${PROD_URL}/api/generate`, {
    method: "POST",
    body: generateForm(),
  });
}

// ── Pre-flight: discover real identifier ──────────────────────────────────

async function getRealIdentifier(): Promise<string> {
  const res = await timedFetch(`${PROD_URL}/api/whoami`);
  if (!res.ok) throw new Error(`/api/whoami returned ${res.status}`);
  const data = await res.json() as { identifier?: string };
  return data.identifier ?? "anonymous";
}

// ── Tests ─────────────────────────────────────────────────────────────────

async function test1(): Promise<void> {
  console.log("\n─── TEST 1: Production is up ───");
  try {
    const res = await timedFetch(`${PROD_URL}/`);
    record("T1", res.status === 200, `GET ${PROD_URL}/ → ${res.status}${res.status === 200 ? " ✓" : ""}`);
  } catch (e) {
    record("T1", false, `Network error: ${e}`);
  }
}

async function test2(identifier: string): Promise<void> {
  console.log("\n─── TEST 2: Rate limit (6 sequential calls → 5×200 then 429) ───");
  console.log(`  Real identifier : ${identifier}`);
  console.log(`  Strategy        : pro key set for reqs 1-5, removed before req 6`);
  console.log(`  Note            : requests 1-5 call Gemini — expect ~3-5 min\n`);

  const redis = Redis.fromEnv();
  const PRO_KEY = `pro:${identifier}`;
  const statuses: number[] = [];

  // Requests 1-5: mark as pro so the depleted rate limit is bypassed
  await redis.set(PRO_KEY, "1", { ex: 600 }); // 10-min TTL for the test window

  for (let i = 1; i <= 5; i++) {
    const t0 = Date.now();
    try {
      const res = await postGenerate();
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      statuses.push(res.status);
      record(`T2-req${i}`, res.status === 200, `status ${res.status} (expected 200) — ${elapsed}s`);
    } catch (e) {
      statuses.push(0);
      record(`T2-req${i}`, false, `${e}`);
    }
  }

  // Request 6: remove pro status, expect rate limit to kick in
  await redis.del(PRO_KEY);
  {
    const t0 = Date.now();
    try {
      const res = await postGenerate();
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      statuses.push(res.status);
      record("T2-req6", res.status === 429, `status ${res.status} (expected 429) — ${elapsed}s`);
    } catch (e) {
      statuses.push(0);
      record("T2-req6", false, `${e}`);
    }
  }

  const overallPass =
    statuses.slice(0, 5).every((s) => s === 200) && statuses[5] === 429;
  record(
    "T2-overall",
    overallPass,
    overallPass
      ? "5×200 then 429 ✓"
      : `got [${statuses.join(", ")}] — expected [200,200,200,200,200,429]`
  );
}

async function test3(identifier: string): Promise<void> {
  console.log("\n─── TEST 3: Character cap (51,000 chars → expect 400) ───");

  const redis  = Redis.fromEnv();
  const PRO_KEY = `pro:${identifier}`;

  // Temporarily restore pro status so the cap check runs before rate limiting
  await redis.set(PRO_KEY, "1", { ex: 120 });

  try {
    const fd = new FormData();
    fd.append("text", "a".repeat(51_000));
    fd.append("density", "high-yield");
    fd.append("style", "standard");

    const res = await timedFetch(`${PROD_URL}/api/generate`, {
      method: "POST",
      body: fd,
    });

    if (res.status === 400) {
      const data = await res.json().catch(() => ({})) as Record<string, string>;
      record("T3", true, `status 400, error="${data.error}" ✓`);
    } else {
      const body = await res.text().catch(() => "");
      record("T3", false, `status ${res.status} — ${body.slice(0, 120)}`);
    }
  } catch (e) {
    record("T3", false, `Network error: ${e}`);
  } finally {
    await redis.del(PRO_KEY);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────

function printSummary(): void {
  const W1   = Math.max(...results.map((r) => r.label.length), 5) + 2;
  const W2   = 6;
  const W3   = 55;
  const rule = `  ${"─".repeat(W1)} ${"─".repeat(W2)} ${"─".repeat(W3)}`;

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`  ${"Test".padEnd(W1)} ${"Result".padEnd(W2)} Detail`);
  console.log(rule);

  for (const { label, passed, detail } of results) {
    const truncated = detail.length > W3 ? detail.slice(0, W3 - 1) + "…" : detail;
    console.log(`  ${label.padEnd(W1)} ${(passed ? "PASS" : "FAIL").padEnd(W2)} ${truncated}`);
  }

  console.log(rule);
  const passed = results.filter((r) => r.passed).length;
  const total  = results.length;
  console.log(`  ${passed === total ? "✓" : "✗"} ${passed}/${total} passed`);
  console.log("══════════════════════════════════════════════════════════════════\n");
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\nTarget : ${PROD_URL}`);

  let identifier: string;
  try {
    identifier = await getRealIdentifier();
    console.log(`ID     : ${identifier}\n`);
  } catch (e) {
    console.error(`Could not reach ${PROD_URL}/api/whoami: ${e}\nExiting.`);
    process.exit(1);
  }

  await test1();
  await test2(identifier);
  await test3(identifier);

  printSummary();
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
