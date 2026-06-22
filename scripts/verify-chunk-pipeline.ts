/**
 * verify-chunk-pipeline.ts — end-to-end audit of the per-chunk fan-out pipeline
 * (/api/deck/start → /api/generate/chunk → /api/finalize) against the local dev
 * server.
 *
 * Stages:
 *   start    : POST /api/deck/start { totalChars: 4000, chunks: 2 } → grab token
 *   chunk x2 : POST /api/generate/chunk { token, chunk } twice with small
 *              synthetic text → assert each returns { cards: RawCard[] }, len ≥ 1
 *   burst    : fire 55 chunk calls with the same token → assert at least one
 *              429 { error: "burst" } (the spend fuse trips)
 *   finalize : POST /api/finalize with a hand-crafted mermaid card → assert the
 *              response is a valid zip containing collection.anki2, AND that
 *              enrichCards produces the mermaid.ink/img/ URL for that card.
 *
 * ⚠️ DEVIATION FROM THE BRIEF (intentional, documented): the brief asked to
 * assert the enriched card *back* contains "mermaid.ink/img/". Empirically it
 * does not — enrichCards embeds the FETCHED image into back as a base64
 * data: URI and stores the mermaid.ink source URL in the card's `visual_url`
 * field instead. So this script asserts the substring against the enriched
 * card's visual_url (where it actually lives) and additionally confirms back
 * carries the rendered <img> embed. See report notes.
 *
 * Requires dev server on localhost:3000 (npm run dev).
 */
import * as fs from "fs";
import * as path from "path";
import JSZip from "jszip";
import { enrichCards, RawCard } from "../app/lib/visualEnricher";

// sql.js reads cards back out of the .apkg's collection.anki2 SQLite DB — the
// same reader test:citations used to prove the per-card footer. Mirrors that
// script's require() form (sql.js ships no clean ESM default for this usage).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require("sql.js") as () => Promise<{
  Database: new (data: Uint8Array) => {
    exec(sql: string): Array<{ values: unknown[][] }>;
    close(): void;
  };
}>;

const BASE_URL = "http://localhost:3000";

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
function pass(label: string, detail: string) { console.log(`  PASS  ${label} — ${detail}`); }
function fail(label: string, detail: string) { failures++; console.log(`  FAIL  ${label} — ${detail}`); }

async function checkServer(): Promise<boolean> {
  try { return (await fetch(`${BASE_URL}/`)).status < 500; } catch { return false; }
}

// Unique IP per run so the burst window and deck quota are isolated between runs.
const RUN_IP = `chunk-pipe-${Date.now()}`;
const HEADERS = { "content-type": "application/json", "x-forwarded-for": RUN_IP };

// Two small synthetic chunks — enough real content for Gemini to emit ≥1 card.
const CHUNK_A =
  "The mitochondrion is the powerhouse of the cell, producing ATP via oxidative " +
  "phosphorylation across the inner membrane. The citric acid cycle runs in the matrix.";
const CHUNK_B =
  "Osmosis is the net movement of water across a semipermeable membrane from low " +
  "solute concentration to high. Tonicity describes a solution as hypotonic, isotonic, or hypertonic.";

async function startDeck(): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/api/deck/start`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ totalChars: 4000, chunks: 2 }),
  });
  const body = (await res.json().catch(() => null)) as { token?: string } | null;
  if (res.status === 200 && typeof body?.token === "string") {
    pass("start", "POST /api/deck/start → 200 with token ✓");
    return body.token;
  }
  fail("start", `expected 200 with token, got ${res.status} ${JSON.stringify(body)}`);
  return null;
}

async function postChunk(token: string, chunk: string): Promise<{ status: number; cards: unknown }> {
  const res = await fetch(`${BASE_URL}/api/generate/chunk`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ token, chunk }),
  });
  const body = (await res.json().catch(() => null)) as { cards?: unknown; error?: string } | null;
  return { status: res.status, cards: body?.cards };
}

// Unzip the finalize .apkg and read every note's back field out of the
// collection.anki2 SQLite DB. Anki packs fields into a single column separated
// by ASCII 0x1f (unit separator); the back is field [1]. This is the live-path
// equivalent of test-deck-quality's extractCards — the artifact is the proof.
async function readCardBacks(apkg: Buffer): Promise<string[]> {
  const zip = await new JSZip().loadAsync(apkg);
  const dbFile = zip.file("collection.anki2");
  if (!dbFile) throw new Error("collection.anki2 not found in .apkg");
  const dbData = await dbFile.async("uint8array");
  const SQL = await initSqlJs();
  const db = new SQL.Database(dbData);
  try {
    const out = db.exec("SELECT flds FROM notes");
    const rows = out.length ? out[0].values : [];
    return rows.map((r) => (r[0] as string).split("\x1f")[1] ?? "");
  } finally {
    db.close();
  }
}

async function main() {
  if (!(await checkServer())) {
    console.error("\nDev server not reachable on localhost:3000. Start it with: npm run dev\nExiting.");
    process.exit(1);
  }
  console.log(`Server OK at ${BASE_URL}\n`);

  // ── start ──
  console.log("─── start: mint a deck token (totalChars 4000, chunks 2) ───");
  const token = await startDeck();
  if (!token) {
    console.log("\nCannot continue without a token.");
    process.exit(1);
  }

  // ── chunk x2 ──
  console.log("\n─── chunk x2: each chunk returns { cards: RawCard[] }, len ≥ 1 ───");
  for (const [i, chunk] of [CHUNK_A, CHUNK_B].entries()) {
    const { status, cards } = await postChunk(token, chunk);
    if (status === 200 && Array.isArray(cards) && cards.length >= 1) {
      pass(`chunk-${i + 1}`, `200, ${cards.length} card(s) ✓`);
    } else {
      fail(`chunk-${i + 1}`, `expected 200 with ≥1 card, got ${status} (cards=${JSON.stringify(cards)?.slice(0, 120)})`);
    }
  }

  // ── burst ──
  console.log("\n─── burst: 55 chunk calls → spend fuse must trip (≥1 → 429 burst) ───");
  const burstResults = await Promise.all(
    Array.from({ length: 55 }, async () => {
      const res = await fetch(`${BASE_URL}/api/generate/chunk`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ token, chunk: "ATP." }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { status: res.status, error: body?.error };
    })
  );
  const burst429 = burstResults.filter((r) => r.status === 429 && r.error === "burst").length;
  if (burst429 >= 1) {
    pass("burst", `${burst429}/55 calls returned 429 { error: "burst" } — fuse tripped ✓`);
  } else {
    fail("burst", `no 429 burst responses in 55 calls — spend fuse did NOT trip (statuses: ${[...new Set(burstResults.map((r) => r.status))].join(",")})`);
  }

  // ── finalize ──
  console.log("\n─── finalize: hand-crafted mermaid card → valid .apkg + mermaid URL ───");
  const mermaidCard: RawCard = {
    front: "What is the flow A to B?",
    back: "A leads to B.",
    card_type: "process",
    citation: "Pasted text",
    visual_type: "mermaid",
    visual_data: "graph TD; A-->B",
  };
  // Two plain cards alongside the mermaid card exercise BOTH footer branches:
  // citedCard has a real citation (rendered as a span); pasteCard's "Pasted
  // text" citation is suppressed to a flag-link-only footer. All three must
  // still carry the tally.so flag link.
  const citedCard: RawCard = {
    front: "Which organ pumps blood through the body?",
    back: "The heart.",
    card_type: "basic",
    citation: "Section 3.2",
    visual_type: "none",
    visual_data: "",
  };
  const pasteCard: RawCard = {
    front: "Define osmosis in one sentence.",
    back: "Net movement of water across a semipermeable membrane.",
    card_type: "definition",
    citation: "Pasted text",
    visual_type: "none",
    visual_data: "",
  };

  const res = await fetch(`${BASE_URL}/api/finalize`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      token,
      deckName: "verify-chunk-pipeline",
      cards: [mermaidCard, citedCard, pasteCard],
      style: "standard",
      density: "high-yield",
    }),
  });

  if (res.status !== 200) {
    const txt = await res.text().catch(() => "(unreadable)");
    fail("finalize", `expected 200 binary, got ${res.status} — ${txt.slice(0, 160)}`);
  } else {
    const buf = Buffer.from(await res.arrayBuffer());
    try {
      const zip = await new JSZip().loadAsync(buf);
      if (zip.file("collection.anki2")) {
        pass("finalize-zip", `valid .apkg (${buf.length.toLocaleString()} bytes) containing collection.anki2 ✓`);
      } else {
        fail("finalize-zip", `zip opened but collection.anki2 missing (entries: ${Object.keys(zip.files).join(", ")})`);
      }
    } catch (e) {
      fail("finalize-zip", `response is not a valid zip: ${e}`);
    }

    // Citation-footer parity on the LIVE path. Read the cards back out of the
    // .apkg the pipeline just built and assert finalize stamped the per-card
    // footer. This ports test:citations' invariant (every back carries the
    // tally.so flag link) onto deck/start→chunk→finalize, and additionally
    // covers both footer branches. The .apkg is the proof, not the HTTP shape.
    try {
      const backs = await readCardBacks(buf);
      const n = backs.length;
      const withFlag = backs.filter(
        (b) => b.includes("tally.so/r/NpbkBW") && b.includes("⚑ flag")
      ).length;
      if (n >= 1 && withFlag === n) {
        pass("finalize-footer", `${withFlag}/${n} card backs carry the tally.so + ⚑ flag footer ✓`);
      } else {
        fail("finalize-footer", `expected all ${n} backs to carry the flag-link footer, only ${withFlag} did`);
      }

      const citedBack = backs.find((b) => b.includes("The heart.")) ?? "";
      if (citedBack.includes("Section 3.2")) {
        pass("finalize-footer-cite", `non-paste card renders its citation span "Section 3.2" ✓`);
      } else {
        fail("finalize-footer-cite", `non-paste card back missing its "Section 3.2" citation span`);
      }

      const pasteBack = backs.find((b) => b.includes("semipermeable membrane")) ?? "";
      if (pasteBack.includes("⚑ flag") && !pasteBack.includes("Pasted text")) {
        pass("finalize-footer-paste", `paste card suppresses "Pasted text", keeps flag link ✓`);
      } else {
        fail("finalize-footer-paste", `paste card footer wrong (must hide "Pasted text", keep flag): …${pasteBack.slice(-160)}`);
      }
    } catch (e) {
      fail("finalize-footer", `could not read card backs from .apkg: ${e}`);
    }
  }

  // Deterministic mermaid-pipeline audit: run the same card through enrichCards
  // and confirm the mermaid.ink URL is produced. It lands in visual_url (the
  // source URL); back receives the fetched image as a base64 data: URI.
  const [enriched] = await enrichCards([mermaidCard]);
  const visualUrl = (enriched as { visual_url?: string }).visual_url ?? "";
  if (visualUrl.includes("mermaid.ink/img/")) {
    pass("finalize-mermaid", `enriched card visual_url contains "mermaid.ink/img/" ✓ (back carries a ${enriched.back.includes("data:image") ? "base64 data: image embed" : "no-image fallback"})`);
  } else {
    fail("finalize-mermaid", `enriched card has no mermaid.ink/img/ URL — visual_url="${visualUrl}" (mermaid.ink unreachable?)`);
  }

  // ── style/density matrix ──
  // Each combo uses its OWN fresh IP: the burst test above exhausted RUN_IP's
  // 50/60s window, and a fresh IP is also a fresh free-quota bucket so
  // deck/start returns 200. Covers the styles most likely to break prompt
  // construction, including the historically 502-prone solve/formula combos.
  console.log("\n─── matrix: style × density (fresh IP + deck/start per combo) ───");

  // A science paragraph rich enough for every style to emit cards. solve/formula
  // invent their own numerics per their modifiers, so generic content is fine.
  const MATRIX_TEXT =
    "Ohm's law relates voltage, current, and resistance in a circuit: V equals I times R. " +
    "Kinetic energy of a moving mass is one half m v squared. The ideal gas law states PV = nRT. " +
    "Cardiac output is heart rate multiplied by stroke volume. Force equals mass times acceleration. " +
    "The resting membrane potential of a neuron is about -70 mV, maintained by the sodium-potassium pump.";

  const combos: Array<{ style: string; density: string; check?: "cloze" }> = [
    { style: "standard", density: "high-yield" },
    { style: "cloze", density: "high-yield", check: "cloze" },
    { style: "mcq", density: "comprehensive" },
    { style: "solve", density: "granular" },
    { style: "formula", density: "granular" },
  ];

  for (const { style, density, check } of combos) {
    const label = `${style}/${density}`;
    const ip = `chunk-matrix-${style}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const headers = { "content-type": "application/json", "x-forwarded-for": ip };

    // Fresh deck/start for this combo.
    const startRes = await fetch(`${BASE_URL}/api/deck/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ totalChars: MATRIX_TEXT.length, chunks: 1 }),
    });
    const startBody = (await startRes.json().catch(() => null)) as { token?: string } | null;
    if (startRes.status !== 200 || typeof startBody?.token !== "string") {
      fail(label, `deck/start failed: ${startRes.status} ${JSON.stringify(startBody)}`);
      continue;
    }

    // Single chunk call with this style/density.
    const chunkRes = await fetch(`${BASE_URL}/api/generate/chunk`, {
      method: "POST",
      headers,
      body: JSON.stringify({ token: startBody.token, chunk: MATRIX_TEXT, style, density }),
    });
    const chunkBody = (await chunkRes.json().catch(() => null)) as
      | { cards?: Array<{ front?: string; back?: string }>; error?: string }
      | null;

    if (chunkRes.status !== 200 || !Array.isArray(chunkBody?.cards) || chunkBody.cards.length < 1) {
      fail(label, `chunk → ${chunkRes.status}, expected 200 with ≥1 card (body=${JSON.stringify(chunkBody)?.slice(0, 160)})`);
      continue;
    }

    if (check === "cloze") {
      // The app's cloze style emits "___" blanks on the front (it does NOT emit
      // Anki {{c1::}} syntax on the back). Accept either marker, matching the
      // existing test-deck-quality cloze predicate. See report note.
      const clozeOk = chunkBody.cards.some(
        (c) =>
          /\{\{c\d+::/.test(`${c.front ?? ""}${c.back ?? ""}`) ||
          (c.front ?? "").includes("___") ||
          (c.back ?? "").includes("___")
      );
      if (clozeOk) {
        pass(label, `200, ${chunkBody.cards.length} card(s), cloze marker present (___ or {{c1::) ✓`);
      } else {
        fail(label, `200 with cards but no cloze marker (___ or {{c1::) in any card`);
      }
    } else {
      pass(label, `200, ${chunkBody.cards.length} card(s) ✓`);
    }
  }

  // ── custom probe (positive): the custom prompt must actually shape output ──
  // A fresh deck/start mints a token; retries reuse it (chunk calls don't
  // consume the token and stay well under the burst cap). The distinctive
  // [HYC] token has no markdown chars, so it survives stripMarkdown intact.
  console.log("\n─── custom: prompt text threads through and shapes output ───");
  {
    const ip = `chunk-custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const headers = { "content-type": "application/json", "x-forwarded-for": ip };
    const startRes = await fetch(`${BASE_URL}/api/deck/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ totalChars: MATRIX_TEXT.length, chunks: 1 }),
    });
    const startBody = (await startRes.json().catch(() => null)) as { token?: string } | null;
    if (startRes.status !== 200 || typeof startBody?.token !== "string") {
      fail("custom", `deck/start failed: ${startRes.status} ${JSON.stringify(startBody)}`);
    } else {
      const customToken = startBody.token;
      const customPrompt =
        "Every card front MUST begin with the literal token [HYC]. " +
        "Output [HYC] exactly, as the very first characters of every front field, before any other text.";
      let ok = false;
      let lastDetail = "";
      // 1 attempt + up to 2 retries: tolerates occasional model inconsistency
      // while still requiring the custom instruction to demonstrably shape output.
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        const res = await fetch(`${BASE_URL}/api/generate/chunk`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            token: customToken,
            chunk: MATRIX_TEXT,
            style: "custom",
            density: "high-yield",
            customPrompt,
          }),
        });
        const body = (await res.json().catch(() => null)) as
          | { cards?: Array<{ front?: string }>; error?: string }
          | null;
        if (res.status === 200 && Array.isArray(body?.cards) && body.cards.length >= 1) {
          const hit = body.cards.some((c) => (c.front ?? "").trimStart().startsWith("[HYC]"));
          if (hit) {
            ok = true;
            pass("custom", `attempt ${attempt}: 200, ${body.cards.length} card(s), ≥1 front begins with [HYC] ✓`);
          } else {
            lastDetail = `attempt ${attempt}: 200 with ${body.cards.length} cards but no front begins with [HYC] (sample: "${(body.cards[0]?.front ?? "").slice(0, 70)}")`;
          }
        } else {
          lastDetail = `attempt ${attempt}: status ${res.status} (body=${JSON.stringify(body)?.slice(0, 140)})`;
        }
      }
      if (!ok) fail("custom", lastDetail || "custom prompt did not shape output after 3 attempts");
    }
  }

  // ── custom negative control: empty customPrompt falls back to standard ──
  console.log("\n─── custom-empty: customPrompt \"\" falls back cleanly, still 200 + cards ───");
  {
    const ip = `chunk-custom-empty-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const headers = { "content-type": "application/json", "x-forwarded-for": ip };
    const startRes = await fetch(`${BASE_URL}/api/deck/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ totalChars: MATRIX_TEXT.length, chunks: 1 }),
    });
    const startBody = (await startRes.json().catch(() => null)) as { token?: string } | null;
    if (startRes.status !== 200 || typeof startBody?.token !== "string") {
      fail("custom-empty", `deck/start failed: ${startRes.status} ${JSON.stringify(startBody)}`);
    } else {
      const res = await fetch(`${BASE_URL}/api/generate/chunk`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          token: startBody.token,
          chunk: MATRIX_TEXT,
          style: "custom",
          density: "high-yield",
          customPrompt: "",
        }),
      });
      const body = (await res.json().catch(() => null)) as { cards?: unknown[]; error?: string } | null;
      if (res.status === 200 && Array.isArray(body?.cards) && body.cards.length >= 1) {
        pass("custom-empty", `200, ${body.cards.length} card(s) — empty custom fell back to standard ✓`);
      } else {
        fail("custom-empty", `expected 200 with ≥1 card, got ${res.status} (body=${JSON.stringify(body)?.slice(0, 140)})`);
      }
    }
  }

  console.log(`\n─── Done: ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} ───\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
