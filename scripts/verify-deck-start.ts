/**
 * verify-deck-start.ts — exercises /api/deck/start against the local dev server.
 *
 * Asserts:
 *   1. free identifier, totalChars 60000        → 400 { error: "characters" }
 *      (over the 50k free cap, rejected before any token is minted)
 *   2. free identifier, totalChars 40000 chunks 4 → 200 with a token
 *   3. free identifier, chunks 99               → 400 { error: "chunks" }
 *   4. the token from (2) passes verifyDeckToken, and fails it after one
 *      payload byte is flipped (HMAC tamper-evidence)
 *   5. Pro identifier (seeded pro: key), totalChars 60000 → 200 cap=300000
 *      pro=true (Pro tier honored); totalChars 300001 → 400 characters (300k
 *      cap enforced). Ported from the deleted verify-caps T1; the credit tier
 *      is intentionally NOT covered — deck/start has no credit branch
 *      (see memory: credit-tier-dead-on-chunked-path).
 *
 * Requires dev server on localhost:3000 (npm run dev), DECK_TOKEN_SECRET in
 * .env.local (the same secret the running server uses, so locally-verified
 * tokens match server-minted ones), and UPSTASH_REDIS_REST_URL/_TOKEN (T5 seeds
 * the pro: key the route reads).
 */
import * as fs from "fs";
import * as path from "path";
import { Redis } from "@upstash/redis";
import { verifyDeckToken } from "../app/lib/deckToken";

const BASE_URL = "http://localhost:3000";

// Load .env.local into process.env so verifyDeckToken sees DECK_TOKEN_SECRET.
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

let failures = 0;
function pass(label: string, detail: string) {
  console.log(`  PASS  ${label} — ${detail}`);
}
function fail(label: string, detail: string) {
  failures++;
  console.log(`  FAIL  ${label} — ${detail}`);
}

async function checkServer(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/`);
    return res.status < 500;
  } catch {
    return false;
  }
}

// A unique IP per run keeps each run in its own rate-limit bucket so the
// 200-path test (which decrements the free quota) doesn't exhaust across runs.
const RUN_ID = `deck-start-verify-${Date.now()}`;

async function startDeck(
  totalChars: number,
  chunks: number,
  ip: string = RUN_ID
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE_URL}/api/deck/start`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ totalChars, chunks }),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, body };
}

// T5 — Pro-tier cap, ported from the deleted verify-caps T1. Seeds pro:<id> (the
// same key isPro() reads), then probes deck/start under that identifier. clientIp
// parses leftmost in dev (see app/lib/clientIp.ts), so x-forwarded-for:<proIp>
// resolves to <proIp> and the seeded entitlement matches. 60k is over the free
// 50k cap but under Pro 300k: a 200 with pro=true/cap=300000 proves the Pro tier
// was actually applied; a 400 characters there means the entitlement wasn't
// honored (identifier mismatch / isPro false) — a hard FAIL, verify-caps'
// semantics. The credit tier is NOT covered: deck/start has no credit branch.
async function testProCap(): Promise<void> {
  let redis: Redis;
  try {
    redis = Redis.fromEnv();
  } catch (e) {
    fail("T5", `cannot reach Redis to seed the pro: tier: ${e}`);
    return;
  }
  const proIp = `deck-start-pro-${Date.now()}`;
  await redis.set(`pro:${proIp}`, "1");
  try {
    const within = await startDeck(60_000, 4, proIp);
    if (within.status === 200 && within.body?.pro === true && Number(within.body?.cap) === 300_000) {
      pass("T5-within", "60,000 chars (Pro) → 200, pro=true, cap=300000 ✓");
    } else if (within.status === 400 && within.body?.error === "characters") {
      fail("T5-within", "60,000 chars (Pro) → 400 characters: seeded pro: entitlement NOT honored (identifier mismatch / isPro false)");
    } else {
      fail("T5-within", `60,000 chars (Pro) → expected 200 pro=true cap=300000, got ${within.status} ${JSON.stringify(within.body)}`);
    }

    const over = await startDeck(300_001, 4, proIp);
    if (over.status === 400 && over.body?.error === "characters") {
      pass("T5-over", "300,001 chars (Pro) → 400 characters: 300k cap enforced ✓");
    } else {
      fail("T5-over", `300,001 chars (Pro) → expected 400 characters, got ${over.status} ${JSON.stringify(over.body)}`);
    }
  } finally {
    await redis.del(`pro:${proIp}`).catch(() => {});
  }
}

async function main() {
  if (!(await checkServer())) {
    console.error("\nDev server not reachable on localhost:3000. Start it with: npm run dev\nExiting.");
    process.exit(1);
  }
  if (!process.env.DECK_TOKEN_SECRET) {
    console.error("\nDECK_TOKEN_SECRET is not set in .env.local. Add it and restart the dev server.\nExiting.");
    process.exit(1);
  }
  console.log(`Server OK at ${BASE_URL}\n`);

  // 1. Over the 50k free cap → character rejection.
  console.log("─── T1: totalChars 60000 (free) → 400 characters ───");
  {
    const { status, body } = await startDeck(60_000, 4);
    if (status === 400 && body?.error === "characters") {
      pass("T1", "60,000 chars → 400 { error: \"characters\" } ✓");
    } else {
      fail("T1", `expected 400 characters, got ${status} ${JSON.stringify(body)}`);
    }
  }

  // 2. Within cap, valid chunk count → token issued.
  console.log("\n─── T2: totalChars 40000, chunks 4 (free) → 200 + token ───");
  let issuedToken: string | null = null;
  {
    const { status, body } = await startDeck(40_000, 4);
    if (status === 200 && typeof body?.token === "string") {
      issuedToken = body.token as string;
      pass("T2", `200 with token (cap=${body.cap}, pro=${body.pro}) ✓`);
    } else {
      fail("T2", `expected 200 with token, got ${status} ${JSON.stringify(body)}`);
    }
  }

  // 3. Chunk count over the sanity cap → chunk rejection.
  console.log("\n─── T3: chunks 99 → 400 chunks ───");
  {
    const { status, body } = await startDeck(40_000, 99);
    if (status === 400 && body?.error === "chunks") {
      pass("T3", "99 chunks → 400 { error: \"chunks\" } ✓");
    } else {
      fail("T3", `expected 400 chunks, got ${status} ${JSON.stringify(body)}`);
    }
  }

  // 4. Token verifies, and a one-byte payload tamper breaks verification.
  console.log("\n─── T4: token verifies; tamper fails ───");
  if (!issuedToken) {
    fail("T4", "no token from T2 to verify");
  } else {
    const verified = verifyDeckToken(issuedToken);
    if (verified && verified.chunks === 4) {
      pass("T4-verify", `verifyDeckToken accepted the token (id=${verified.id}, chunks=${verified.chunks}) ✓`);
    } else {
      fail("T4-verify", `verifyDeckToken rejected a freshly issued token: ${JSON.stringify(verified)}`);
    }

    // Flip one byte in the payload (pre-dot) segment. Any change invalidates the HMAC.
    const dot = issuedToken.indexOf(".");
    const first = issuedToken[0];
    const swapped = first === "A" ? "B" : "A";
    const tampered = swapped + issuedToken.slice(1, dot) + issuedToken.slice(dot);
    if (verifyDeckToken(tampered) === null) {
      pass("T4-tamper", "one-byte payload tamper → verifyDeckToken returned null ✓");
    } else {
      fail("T4-tamper", "tampered token still verified — HMAC check is not effective");
    }
  }

  // 5. Pro tier → 300k cap honored on the live path (ported from verify-caps T1).
  console.log("\n─── T5: Pro tier → 300k cap (60k accepted, 300,001 rejected) ───");
  await testProCap();

  console.log(`\n─── Done: ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} ───\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
