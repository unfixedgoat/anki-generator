/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * verify-stripe.ts — End-to-end Stripe integration tests
 *
 * TEST 1: Checkout session — pro_monthly      → expect 200 + checkout.stripe.com URL
 * TEST 2: Checkout session — one_time_deck    → expect 200 + checkout.stripe.com URL
 * TEST 3: Invalid plan rejection              → expect non-200
 * TEST 4: isPro (unpurchased)                 → expect false
 * TEST 5: isPro (simulate purchase via Redis) → expect true
 * TEST 6: isPro bypasses rate limit           → expect 200 from /api/generate
 * TEST 7: Cleanup                             → expect isPro false after del
 *
 * Requires dev server on localhost:3000.
 */

import * as fs from "fs";
import * as path from "path";

// Load .env.local BEFORE requiring any module that calls Redis.fromEnv() at
// module-init time. Static `import` statements compile to require() and run
// first, but built-in modules (fs, path) have no env deps — only the
// dynamic require() calls below need the env vars to be present.
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

const BASE_URL = "http://localhost:3000";
const TEST_ID  = "test-ip-verify";

const SAMPLE_TEXT =
  "The sodium-potassium ATPase pump moves 3 Na+ out and 2 K+ in per " +
  "cycle, consuming 1 ATP. This maintains the resting membrane potential " +
  "of approximately -70mV in neurons. Failure of this pump leads to " +
  "cellular swelling and depolarization. The pump is inhibited by " +
  "ouabain and cardiac glycosides like digoxin. Action potential " +
  "propagation velocity increases with axon diameter and myelination. " +
  "Saltatory conduction between nodes of Ranvier allows speeds up to " +
  "120 m/s in large myelinated fibers.";

function pass(label: string, detail: string) {
  console.log(`  PASS  ${label} — ${detail}`);
}
function fail(label: string, detail: string) {
  console.log(`  FAIL  ${label} — ${detail}`);
}

async function checkServer(): Promise<boolean> {
  try {
    return (await fetch(`${BASE_URL}/`)).status < 500;
  } catch {
    return false;
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────

async function postCheckout(plan: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/stripe/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, identifier: TEST_ID }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

async function test1() {
  console.log("\n─── TEST 1: Checkout session — pro_monthly ───");
  let res: Response;
  try {
    res = await postCheckout("pro_monthly");
  } catch (e) {
    fail("T1", `Network error: ${e}`); return;
  }
  if (res.status !== 200) {
    const body = await res.text().catch(() => "");
    fail("T1", `status ${res.status} — ${body.slice(0, 160)}`); return;
  }
  const data = await res.json();
  if (typeof data.url === "string" && data.url.startsWith("https://checkout.stripe.com")) {
    pass("T1", `status 200, url: ${data.url.slice(0, 60)}…`);
  } else {
    fail("T1", `status 200 but url missing/wrong — ${JSON.stringify(data).slice(0, 160)}`);
  }
}

async function test2() {
  console.log("\n─── TEST 2: Checkout session — one_time_deck ───");
  let res: Response;
  try {
    res = await postCheckout("one_time_deck");
  } catch (e) {
    fail("T2", `Network error: ${e}`); return;
  }
  if (res.status !== 200) {
    const body = await res.text().catch(() => "");
    fail("T2", `status ${res.status} — ${body.slice(0, 160)}`); return;
  }
  const data = await res.json();
  if (typeof data.url === "string" && data.url.startsWith("https://checkout.stripe.com")) {
    pass("T2", `status 200, url: ${data.url.slice(0, 60)}…`);
  } else {
    fail("T2", `status 200 but url missing/wrong — ${JSON.stringify(data).slice(0, 160)}`);
  }
}

async function test3() {
  console.log("\n─── TEST 3: Invalid plan rejection ───");
  const res = await postCheckout("fake_plan");
  if (res.status !== 200) {
    pass("T3", `status ${res.status} (not 200) ✓`);
  } else {
    fail("T3", "status 200 — invalid plan was not rejected");
  }
}

async function test4() {
  console.log("\n─── TEST 4: isPro — unpurchased ───");
  // Ensure no stale key before testing
  const redis = Redis.fromEnv();
  await redis.del(`pro:${TEST_ID}`);
  const result = await isPro(TEST_ID);
  if (result === false) {
    pass("T4", `isPro("${TEST_ID}") === false ✓`);
  } else {
    fail("T4", `isPro("${TEST_ID}") returned true (stale Redis key?)`);
  }
}

async function test5() {
  console.log("\n─── TEST 5: isPro — simulate purchase ───");
  const redis = Redis.fromEnv();
  await redis.set(`pro:${TEST_ID}`, "1", { ex: 60 });
  const result = await isPro(TEST_ID);
  if (result === true) {
    pass("T5", `Redis set + isPro("${TEST_ID}") === true ✓`);
  } else {
    fail("T5", `isPro still returns false — Redis set may have failed`);
  }
}

async function test6() {
  console.log("\n─── TEST 6: isPro bypasses rate limit (/api/generate) ───");
  // pro:test-ip-verify should still be set from Test 5
  const stillPro = await isPro(TEST_ID);
  if (!stillPro) {
    fail("T6", "pre-condition failed — isPro is false (Test 5 may not have passed); skipping");
    return;
  }
  const fd = new FormData();
  fd.append("text", SAMPLE_TEXT);
  fd.append("density", "high-yield");
  fd.append("style", "standard");
  const res = await fetch(`${BASE_URL}/api/generate`, {
    method: "POST",
    body: fd,
    headers: { "x-forwarded-for": TEST_ID },
  });
  if (res.status === 200) {
    const blob = await res.blob();
    pass("T6", `status 200, blob ${blob.size.toLocaleString()} bytes — rate limit bypassed ✓`);
  } else {
    const body = await res.text().catch(() => "");
    fail("T6", `status ${res.status} — ${body.slice(0, 160)}`);
  }
}

async function test8() {
  console.log("\n─── TEST 8: invoice.payment_succeeded webhook refreshes pro key ───");

  const redis = Redis.fromEnv();
  await redis.del(`pro:${TEST_ID}`);

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!webhookSecret || !stripeSecretKey) {
    fail("T8", "STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY not set — cannot forge webhook");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const StripeLib = require("stripe") as any;
  const stripe = new StripeLib(stripeSecretKey);

  const timestamp = Math.floor(Date.now() / 1000);
  const invoicePayload = {
    id: `evt_test_invoice_${timestamp}`,
    object: "event",
    api_version: "2023-10-16",
    type: "invoice.payment_succeeded",
    livemode: false,
    pending_webhooks: 1,
    request: null,
    data: {
      object: {
        id: `in_test_${timestamp}`,
        object: "invoice",
        subscription: "sub_test_123",
        subscription_details: {
          metadata: { identifier: TEST_ID },
        },
      },
    },
  };

  const payload = JSON.stringify(invoicePayload);
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
    timestamp,
  });

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": header },
      body: payload,
    });
  } catch (e) {
    fail("T8", `Network error: ${e}`); return;
  }

  if (res.status !== 200) {
    const body = await res.text().catch(() => "");
    fail("T8", `status ${res.status} — ${body.slice(0, 160)}`); return;
  }

  const val = await redis.get(`pro:${TEST_ID}`);
  if (val == null || String(val) !== "1") {
    fail("T8", `Redis key pro:${TEST_ID} not set (got ${JSON.stringify(val)})`); return;
  }

  const ttl = await redis.ttl(`pro:${TEST_ID}`);
  const thirtyDays = 30 * 24 * 60 * 60;
  if (ttl > thirtyDays) {
    pass("T8", `pro:${TEST_ID} written, TTL ${ttl}s (${Math.round(ttl / 86400)}d) > 30d ✓`);
  } else {
    fail("T8", `TTL = ${ttl}s — expected > ${thirtyDays}s (30d)`);
  }

  await redis.del(`pro:${TEST_ID}`);
}

async function test7() {
  console.log("\n─── TEST 7: Cleanup ───");
  const redis = Redis.fromEnv();
  await redis.del(`pro:${TEST_ID}`);
  const result = await isPro(TEST_ID);
  if (result === false) {
    pass("T7", `deleted pro:${TEST_ID}, isPro === false ✓`);
  } else {
    fail("T7", `isPro still true after del — key may not have been removed`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const up = await checkServer();
  if (!up) {
    console.error(
      "\nWARNING: Dev server not reachable on localhost:3000.\n" +
        "Start it with: npm run dev\nExiting."
    );
    process.exit(1);
  }
  console.log(`Server OK at ${BASE_URL}\n`);

  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  await test6();
  await test7();
  await test8();

  console.log("\n─── Done ───\n");
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
