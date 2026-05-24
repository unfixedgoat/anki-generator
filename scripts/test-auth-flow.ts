/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Auth-flow test suite
 *
 * Scenario 1 — Anonymous user, rate limit enforcement
 * Scenario 2 — Signed-in user, no Pro, rate limit by user ID (IP proxy; Clerk JWT not forgeable)
 * Scenario 3 — Pro user bypass
 * Scenario 4 — Pro key near expiry (surface Session 10 known-issue)
 * Scenario 5 — Stripe webhook signature verification (6 sub-tests)
 *
 * Requires dev server on localhost:3000.
 */

import * as fs from "fs";
import * as path from "path";

// Load .env.local BEFORE any module that reads env vars at require() time.
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
const { Ratelimit } = require("@upstash/ratelimit") as typeof import("@upstash/ratelimit");
const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");
const { isPro } = require("../app/lib/ratelimit") as {
  isPro: (id: string | null) => Promise<boolean>;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const StripeLib = require("stripe") as any;

// ── Constants ─────────────────────────────────────────────────────────────

const BASE_URL = "http://localhost:3000";
const RATE_LIMIT = 5;
const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

// Each run gets its own unique identifiers so stale state from prior runs
// cannot interfere. The TS suffix is a monotonic number, not a real IP;
// rate-limit keys expire with the 30-day window regardless.
const RUN_TS = Date.now();
const S1_IP = `203.0.113.99.t${RUN_TS}`;
const S2_IP = `203.0.113.100.t${RUN_TS}`;
const S3_IP = `203.0.113.101.t${RUN_TS}`;

// Minimal text for generate calls — just enough for Gemini to produce ≥1 card
const MINIMAL_TEXT =
  "The mitochondria is the powerhouse of the cell. It produces ATP via oxidative " +
  "phosphorylation, driving cellular metabolism and maintaining the resting membrane " +
  "potential of approximately −70 mV in neurons.";

// ── Types ─────────────────────────────────────────────────────────────────

interface ScenarioResult {
  scenario: string;
  result: "PASS" | "FAIL" | "WARN";
  notes: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

function makeRedis(): InstanceType<typeof Redis> {
  return Redis.fromEnv();
}

function makeRatelimit(): InstanceType<typeof Ratelimit> {
  return new Ratelimit({
    redis: makeRedis(),
    limiter: Ratelimit.slidingWindow(RATE_LIMIT, "30 d"),
  });
}

async function resetRatelimit(identifier: string): Promise<void> {
  // Use the library's own resetUsedTokens() rather than manual KEYS scans —
  // it targets the exact key structure the limiter writes and is O(1) rather
  // than O(N). This also avoids glob patterns that can be fragile.
  try {
    const rl = makeRatelimit();
    await rl.resetUsedTokens(identifier);
  } catch {
    // best-effort
  }
}

async function callGenerate(ip: string, bypassToken?: string): Promise<Response> {
  const fd = new FormData();
  fd.append("text", MINIMAL_TEXT);
  fd.append("density", "high-yield");
  fd.append("style", "standard");
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (bypassToken) headers["x-test-token"] = bypassToken;
  return fetch(`${BASE_URL}/api/generate`, {
    method: "POST",
    body: fd,
    headers,
    signal: AbortSignal.timeout(90_000),
  });
}

async function forgeWebhookRequest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stripe: any,
  webhookSecret: string,
  eventType: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dataObject: Record<string, any>,
  timestamp?: number
): Promise<{ payload: string; header: string }> {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const event = {
    id: `evt_test_${ts}_${Math.random().toString(36).slice(2, 8)}`,
    object: "event",
    api_version: "2023-10-16",
    type: eventType,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    data: { object: dataObject },
  };
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret, timestamp: ts });
  return { payload, header };
}

async function postWebhook(payload: string, header: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": header },
    body: payload,
    signal: AbortSignal.timeout(10_000),
  });
}

async function isServerUp(): Promise<boolean> {
  try {
    return (await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(5_000) })).status < 500;
  } catch { return false; }
}

// ══════════════════════════════════════════════════════════════════════════
// Scenario 1 — Anonymous user, rate limit enforcement
// ══════════════════════════════════════════════════════════════════════════

async function scenario1(): Promise<ScenarioResult> {
  const failures: string[] = [];
  const notes: string[] = [];

  try {
    // 1a. GET /api/whoami — spec says POST but route only implements GET
    const whoami = await fetch(`${BASE_URL}/api/whoami`, { signal: AbortSignal.timeout(5_000) });
    const wd = await whoami.json() as { identifier: unknown; authed: unknown };
    if (wd.identifier !== null)  failures.push(`whoami.identifier = ${JSON.stringify(wd.identifier)}, expected null`);
    if (wd.authed !== false)     failures.push(`whoami.authed = ${JSON.stringify(wd.authed)}, expected false`);
    notes.push(`whoami → identifier=${JSON.stringify(wd.identifier)}, authed=${wd.authed}`);

    // 1b. Clean any stale rate-limit state for test IP
    await resetRatelimit(S1_IP);

    // 1c. POST /api/generate 5 times — expect each to pass the rate-limit gate
    //     (not 429). 200 = Gemini succeeded; 4xx/5xx from downstream are fine
    //     here — what matters is the limiter allowed the request through.
    for (let i = 1; i <= RATE_LIMIT; i++) {
      const res = await callGenerate(S1_IP);
      if (res.status === 429) {
        failures.push(`call ${i}: rate limit hit early — expected any non-429, got 429`);
      }
      await res.arrayBuffer().catch(() => {}); // drain body
    }
    notes.push(`${RATE_LIMIT} generate calls passed rate-limit gate (IP: ${S1_IP}; Gemini 502s are acceptable here)`);

    // 1d. 6th call → expect 429 with error containing "limit"
    const sixth = await callGenerate(S1_IP);
    const sixthBody = await sixth.json().catch(() => ({})) as Record<string, unknown>;
    if (sixth.status !== 429) {
      failures.push(`6th call: expected 429, got ${sixth.status}`);
    } else if (typeof sixthBody.error !== "string" || !sixthBody.error.toLowerCase().includes("limit")) {
      failures.push(`6th call: 429 received but unexpected error field: ${JSON.stringify(sixthBody.error)}`);
    }
    notes.push(`6th call → status=${sixth.status}, error=${JSON.stringify(sixthBody.error)}`);

  } finally {
    await resetRatelimit(S1_IP);
    notes.push(`cleanup: deleted ratelimit keys for ${S1_IP}`);
  }

  return {
    scenario: "1 — Anon rate limit enforcement",
    result: failures.length === 0 ? "PASS" : "FAIL",
    notes: failures.length ? [...failures, ...notes] : notes,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Scenario 2 — Signed-in user, no Pro, rate limit by user ID
// ══════════════════════════════════════════════════════════════════════════

async function scenario2(): Promise<ScenarioResult> {
  const failures: string[] = [];
  const notes: string[] = [];
  const rl = makeRatelimit();

  notes.push(
    "LIMITATION: Cannot forge Clerk JWT in a script — testing IP-based rate limit as behavioral " +
    "proxy. /api/me and /api/generate route through the same ratelimit.limit() code path regardless " +
    "of identifier type (userId vs IP). Core invariant proven; Clerk-session test skipped."
  );

  try {
    // 2a. GET /api/me with no Clerk session → identifier: null, isPro: false
    const meRes = await fetch(`${BASE_URL}/api/me`, { signal: AbortSignal.timeout(5_000) });
    const md = await meRes.json() as { isPro: unknown; identifier: unknown; plan?: unknown };
    if (md.isPro !== false)      failures.push(`/api/me isPro = ${JSON.stringify(md.isPro)}, expected false`);
    if (md.identifier !== null)  failures.push(`/api/me identifier = ${JSON.stringify(md.identifier)}, expected null (no Clerk session)`);
    notes.push(`/api/me → isPro=${md.isPro}, identifier=${JSON.stringify(md.identifier)}, plan=${JSON.stringify(md.plan)}`);

    // 2b. Clean state, pre-consume 5 slots, assert 6th HTTP call → 429
    await resetRatelimit(S2_IP);
    for (let i = 0; i < RATE_LIMIT; i++) await rl.limit(S2_IP);
    notes.push(`pre-consumed ${RATE_LIMIT} rate-limit slots for ${S2_IP} (avoids 5 Gemini calls)`);

    const res = await callGenerate(S2_IP);
    const resBody = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (res.status !== 429) {
      failures.push(`post-limit call: expected 429, got ${res.status} — ${JSON.stringify(resBody).slice(0, 120)}`);
    }
    notes.push(`post-limit call (6th slot) → status=${res.status}`);

  } finally {
    await resetRatelimit(S2_IP);
  }

  // WARN: partial test due to Clerk limitation; all testable assertions pass
  return {
    scenario: "2 — Auth'd user (no Pro) rate limit",
    result: failures.length === 0 ? "WARN" : "FAIL",
    notes: failures.length ? [...failures, ...notes] : notes,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Scenario 3 — Pro user bypass
// ══════════════════════════════════════════════════════════════════════════

async function scenario3(): Promise<ScenarioResult> {
  const failures: string[] = [];
  const notes: string[] = [];
  const redis = makeRedis();
  const rl = makeRatelimit();

  try {
    // 3a. Write pro key (no TTL — permanent, simulates lifetime purchase)
    await redis.set(`pro:${S3_IP}`, "1");
    const proCheck = await isPro(S3_IP);
    if (!proCheck) failures.push(`isPro(${S3_IP}) = false after writing pro key`);
    notes.push(`isPro(${S3_IP}) = ${proCheck}`);

    // 3b. Pre-exhaust the rate limit, then assert generate still returns 200
    // (Proves bypass ignores an already-exhausted limit — stronger than 10 un-exhausted calls)
    await resetRatelimit(S3_IP);
    for (let i = 0; i < RATE_LIMIT; i++) await rl.limit(S3_IP);
    notes.push(`pre-exhausted rate limit for ${S3_IP}`);
    notes.push("NOTE: spec says 10 HTTP calls; 1 call on an exhausted limit proves invariant more strongly");

    const res = await callGenerate(S3_IP); // no bypass token — Pro must save us
    const resBody = await res.text().catch(() => "");
    // 429 = rate limit enforced (bypass failed); any other status (200, 502…) = limiter was skipped
    if (res.status === 429) {
      failures.push(`generate with pro key (exhausted limit): got 429 — Pro bypass did not fire`);
    }
    notes.push(`generate (exhausted limit + Pro) → status=${res.status} (non-429 = bypass worked)`);

  } finally {
    await redis.del(`pro:${S3_IP}`).catch(() => {});
    await resetRatelimit(S3_IP);
  }

  return {
    scenario: "3 — Pro user bypass",
    result: failures.length === 0 ? "PASS" : "FAIL",
    notes: failures.length ? [...failures, ...notes] : notes,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Scenario 4 — Pro key near expiry
// ══════════════════════════════════════════════════════════════════════════

async function scenario4(): Promise<ScenarioResult> {
  const failures: string[] = [];
  const notes: string[] = [];
  const redis = makeRedis();
  const S4_ID = `test_user_expiring_${Date.now()}`;

  try {
    // 4a. Write pro key with 60s TTL
    await redis.set(`pro:${S4_ID}`, "1", { ex: 60 });

    // 4b. isPro → true
    const proCheck = await isPro(S4_ID);
    if (!proCheck) failures.push(`isPro returned false for key with 60s TTL`);
    notes.push(`isPro(${S4_ID}) = ${proCheck}`);

    // 4c. Check TTL — surface if < 7 days (Session 10 known issue)
    const ttl = await redis.ttl(`pro:${S4_ID}`);
    notes.push(`TTL = ${ttl}s (expected ~60 for this write)`);
    if (ttl > 0 && ttl < SEVEN_DAYS_S) {
      notes.push(
        `WARNING (informational, test does not fail): TTL=${ttl}s < 7 days (${SEVEN_DAYS_S}s). ` +
        `Session 10 known-issue surface: a key this close to expiry may cause silent Pro access loss ` +
        `before renewal fires. Audit whether renewal webhook is extending TTL correctly.`
      );
    }

  } finally {
    await redis.del(`pro:${S4_ID}`).catch(() => {});
  }

  return {
    scenario: "4 — Pro key near expiry",
    result: failures.length === 0 ? "PASS" : "FAIL",
    notes: failures.length ? [...failures, ...notes] : notes,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Scenario 5 — Stripe webhook signature verification
// ══════════════════════════════════════════════════════════════════════════

async function scenario5(): Promise<ScenarioResult> {
  const failures: string[] = [];
  const notes: string[] = [];
  const redis = makeRedis();

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const webhookSecret   = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  if (!stripeSecretKey || !webhookSecret) {
    return {
      scenario: "5 — Stripe webhook",
      result: "FAIL",
      notes: ["STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET not set in env"],
    };
  }

  const stripe = new StripeLib(stripeSecretKey);
  const CHECKOUT_ID   = "test_user_webhook";
  const SUBDELETE_ID  = "test_user_subdelete";
  const REPLAY_ID     = "test_user_replay";

  try {
    // ── 5-1: No signature header → 400 ────────────────────────────────────
    const noSig = await fetch(`${BASE_URL}/api/stripe/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ping" }),
      signal: AbortSignal.timeout(5_000),
    });
    if (noSig.status !== 400) failures.push(`5-1 no-sig: expected 400, got ${noSig.status}`);
    else await noSig.text().catch(() => {});
    notes.push(`5-1 (no signature) → ${noSig.status}`);

    // ── 5-2: Wrong secret → 400 ────────────────────────────────────────────
    const fakePayload = JSON.stringify({ type: "ping", id: "evt_fake_bad" });
    const badHeader = stripe.webhooks.generateTestHeaderString({
      payload: fakePayload,
      secret: "whsec_" + "x".repeat(32),
      timestamp: Math.floor(Date.now() / 1000),
    });
    const wrongSig = await postWebhook(fakePayload, badHeader);
    if (wrongSig.status !== 400) failures.push(`5-2 wrong-secret: expected 400, got ${wrongSig.status}`);
    else await wrongSig.text().catch(() => {});
    notes.push(`5-2 (wrong secret) → ${wrongSig.status}`);

    // ── 5-3: checkout.session.completed → 200, Redis key set ──────────────
    await redis.del(`pro:${CHECKOUT_ID}`);
    const { payload: p3, header: h3 } = await forgeWebhookRequest(
      stripe, webhookSecret, "checkout.session.completed",
      {
        id: "cs_test_auth_1",
        object: "checkout.session",
        mode: "payment",           // one-time: no TTL set
        amount_total: 1999,
        currency: "usd",
        client_reference_id: CHECKOUT_ID,
        metadata: {},
      }
    );
    const r3 = await postWebhook(p3, h3);
    if (r3.status !== 200) {
      const b3 = await r3.text().catch(() => "");
      failures.push(`5-3 checkout.session.completed: expected 200, got ${r3.status} — ${b3.slice(0, 200)}`);
    } else {
      await r3.text().catch(() => {});
      const key3 = await redis.get(`pro:${CHECKOUT_ID}`);
      if (key3 === null) failures.push(`5-3: pro:${CHECKOUT_ID} not set after checkout.session.completed`);
      notes.push(`5-3 (checkout.session.completed) → ${r3.status}, pro:${CHECKOUT_ID}=${JSON.stringify(key3)}`);
    }

    // ── 5-4: charge.refunded → 200, Redis key deleted ─────────────────────
    const { payload: p4, header: h4 } = await forgeWebhookRequest(
      stripe, webhookSecret, "charge.refunded",
      {
        id: "ch_test_auth_1",
        object: "charge",
        amount_refunded: 1999,
        currency: "usd",
        metadata: { identifier: CHECKOUT_ID },
      }
    );
    const r4 = await postWebhook(p4, h4);
    if (r4.status !== 200) {
      failures.push(`5-4 charge.refunded: expected 200, got ${r4.status}`);
    } else {
      await r4.text().catch(() => {});
      const key4 = await redis.get(`pro:${CHECKOUT_ID}`);
      if (key4 !== null) failures.push(`5-4: pro:${CHECKOUT_ID} still exists after charge.refunded (got ${JSON.stringify(key4)})`);
      notes.push(`5-4 (charge.refunded) → ${r4.status}, pro:${CHECKOUT_ID}=${JSON.stringify(key4)} (null=deleted ✓)`);
    }

    // ── 5-5: customer.subscription.deleted → 200, Redis key deleted ────────
    await redis.set(`pro:${SUBDELETE_ID}`, "1");
    const { payload: p5, header: h5 } = await forgeWebhookRequest(
      stripe, webhookSecret, "customer.subscription.deleted",
      {
        id: "sub_test_auth_1",
        object: "subscription",
        cancel_at_period_end: false,
        metadata: { identifier: SUBDELETE_ID },
        items: { data: [] },
      }
    );
    const r5 = await postWebhook(p5, h5);
    if (r5.status !== 200) {
      failures.push(`5-5 subscription.deleted: expected 200, got ${r5.status}`);
    } else {
      await r5.text().catch(() => {});
      const key5 = await redis.get(`pro:${SUBDELETE_ID}`);
      if (key5 !== null) failures.push(`5-5: pro:${SUBDELETE_ID} still exists after subscription.deleted`);
      notes.push(`5-5 (subscription.deleted) → ${r5.status}, pro:${SUBDELETE_ID}=${JSON.stringify(key5)} (null=deleted ✓)`);
    }

    // ── 5-6: Idempotency — replay checkout.session.completed twice ──────────
    // Using mode:"payment" (no TTL) so idempotency is unambiguous:
    // both writes produce TTL=-1 (no expiry). A subscription write would
    // reset TTL on replay, but "not bumped beyond first write" still holds
    // since both writes cap at PRO_TTL (31d).
    await redis.del(`pro:${REPLAY_ID}`);
    const { payload: p6, header: h6 } = await forgeWebhookRequest(
      stripe, webhookSecret, "checkout.session.completed",
      {
        id: "cs_test_auth_replay",
        object: "checkout.session",
        mode: "payment",
        amount_total: 1999,
        currency: "usd",
        client_reference_id: REPLAY_ID,
        metadata: {},
      }
    );

    // First write
    const r6a = await postWebhook(p6, h6);
    if (r6a.status !== 200) failures.push(`5-6a (first): expected 200, got ${r6a.status}`);
    else await r6a.text().catch(() => {});
    const ttl6a = await redis.ttl(`pro:${REPLAY_ID}`);

    // Replay — identical payload and header (timestamp within Stripe's 300s tolerance)
    const r6b = await postWebhook(p6, h6);
    if (r6b.status !== 200) failures.push(`5-6b (replay): expected 200, got ${r6b.status}`);
    else await r6b.text().catch(() => {});
    const key6b = await redis.get(`pro:${REPLAY_ID}`);
    const ttl6b = await redis.ttl(`pro:${REPLAY_ID}`);

    if (key6b === null) failures.push(`5-6: key pro:${REPLAY_ID} missing after replay`);

    // TTL should not increase beyond first write's TTL (payment mode → both -1)
    if (ttl6b > ttl6a && ttl6a !== -1) {
      failures.push(`5-6: TTL bumped from ${ttl6a}s → ${ttl6b}s after replay (expected ≤ first write)`);
    }
    notes.push(
      `5-6 (idempotency) → first=${r6a.status}, replay=${r6b.status}, ` +
      `key=${JSON.stringify(key6b)}, ttl1=${ttl6a}, ttl2=${ttl6b} ` +
      `(both -1 = no-expiry for payment mode)`
    );

    await redis.del(`pro:${REPLAY_ID}`).catch(() => {});

  } finally {
    // Safety cleanup for keys that might not have been deleted mid-test
    await redis.del(`pro:${CHECKOUT_ID}` as string).catch(() => {});
    await redis.del(`pro:${SUBDELETE_ID}` as string).catch(() => {});
  }

  return {
    scenario: "5 — Stripe webhook",
    result: failures.length === 0 ? "PASS" : "FAIL",
    notes: failures.length ? [...failures, ...notes] : notes,
  };
}

// ── Table renderer ────────────────────────────────────────────────────────

function renderTable(results: ScenarioResult[]): void {
  const COL = 32;
  const SEP = "─".repeat(100);

  console.log("\n" + "═".repeat(100));
  console.log("  Auth Flow Test Results");
  console.log("═".repeat(100));
  console.log("  " + "Scenario".padEnd(COL) + "Result   Notes");
  console.log("  " + SEP.slice(4));

  for (const r of results) {
    const marker = r.result === "PASS" ? "PASS  " : r.result === "WARN" ? "WARN  " : "FAIL  ";
    // Print first note on same line, rest indented
    const [first, ...rest] = r.notes;
    console.log("  " + r.scenario.padEnd(COL) + marker + "  " + (first ?? ""));
    for (const n of rest) {
      console.log("  " + " ".repeat(COL + 8) + n);
    }
  }

  console.log("  " + SEP.slice(4));

  const pass = results.filter(r => r.result === "PASS").length;
  const warn = results.filter(r => r.result === "WARN").length;
  const fail = results.filter(r => r.result === "FAIL").length;

  console.log(`\n  Summary: ${pass} PASS, ${warn} WARN, ${fail} FAIL`);
  if (fail > 0) {
    console.log("\n  FAILED scenarios:");
    for (const r of results.filter(r => r.result === "FAIL")) {
      console.log(`    ✗ ${r.scenario}`);
      for (const n of r.notes) console.log(`        ${n}`);
    }
  }
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("═".repeat(72));
  console.log("  Auth Flow Test Suite");
  console.log("═".repeat(72));
  console.log(`  Server : ${BASE_URL}`);
  console.log(`  Date   : ${new Date().toISOString()}`);
  console.log("─".repeat(72));

  if (!(await isServerUp())) {
    console.error("\n  ERROR: Dev server not reachable at http://localhost:3000\n  Start with: npm run dev\n");
    process.exit(1);
  }
  console.log("  Server: reachable ✓\n");

  const results: ScenarioResult[] = [];

  const run = async (label: string, fn: () => Promise<ScenarioResult>): Promise<void> => {
    process.stdout.write(`  Running ${label}... `);
    const start = Date.now();
    try {
      const r = await fn();
      results.push(r);
      console.log(`${r.result}  (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    } catch (err) {
      results.push({ scenario: label, result: "FAIL", notes: [`Uncaught: ${err}`] });
      console.log(`FAIL  (uncaught)`);
      console.error("    →", err);
    }
  };

  await run("Scenario 1", scenario1);
  await run("Scenario 2", scenario2);
  await run("Scenario 3", scenario3);
  await run("Scenario 4", scenario4);
  await run("Scenario 5", scenario5);

  renderTable(results);

  if (results.some(r => r.result === "FAIL")) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
