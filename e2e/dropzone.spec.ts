import { test, expect, type Page, type Route } from "@playwright/test";

// ── Multi-chunk fixture ──────────────────────────────────────────────────────
// ~44k chars of \n\n-separated paragraphs: under the 50k free char cap (so the
// client pre-check passes) but well over 12k, so chunkText(…, 12000) yields ≥4
// chunks → exercises batching, ordered merge, and the "X/N" progress label.
// A unique marker lives in exactly ONE paragraph so a single chunk can be failed
// deterministically by request-body content (both its primary attempt and retry).
const PARA = "The mitochondrion is the powerhouse of the cell. ".repeat(60); // ~2.9k chars
const FAIL_MARKER = "ZZFAILCHUNKZZ";

function multiChunkText(withMarker = false): string {
  return Array.from({ length: 15 }, (_, i) =>
    withMarker && i === 7 ? `${FAIL_MARKER}. ${PARA}` : PARA
  ).join("\n\n");
}

// ── Route mocks ──────────────────────────────────────────────────────────────
// Defaults give a clean happy path; any test can override a single route.
type Stubs = {
  isPro?: boolean;
  deckStart?: (route: Route) => unknown;
  chunk?: (route: Route) => unknown;
  finalize?: (route: Route) => unknown;
};

const okChunk = (route: Route) =>
  route.fulfill({ json: { cards: [{ front: "Q", back: "A", card_type: "basic", citation: "Pasted text" }] } });

const okFinalize = (route: Route) =>
  route.fulfill({
    contentType: "application/octet-stream",
    headers: { "content-disposition": 'attachment; filename="deck.apkg"', "x-card-count": "9" },
    body: Buffer.from("PK\x03\x04 stub-apkg"), // client only triggers a download + reads headers
  });

async function stub(page: Page, s: Stubs = {}): Promise<void> {
  await page.route("**/api/whoami", (r) => r.fulfill({ json: { identifier: "test-user" } }));
  await page.route("**/api/me", (r) => r.fulfill({ json: { isPro: s.isPro ?? false } }));
  await page.route("**/api/deck/start", s.deckStart ?? ((r) => r.fulfill({ json: { token: "tok", cap: 50000, pro: false } })));
  await page.route("**/api/generate/chunk", s.chunk ?? okChunk);
  await page.route("**/api/finalize", s.finalize ?? okFinalize);
}

async function pasteText(page: Page, text: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Paste" }).click();
  await page.getByPlaceholder(/Paste your notes/).fill(text);
}

const generate = (page: Page) => page.getByRole("button", { name: "Generate" }).click();

// ─────────────────────────────────────────────────────────────────────────────

test("happy multi-chunk paste → progress X/N, ordered merge, downloads", async ({ page }) => {
  let n = 0;
  await stub(page, {
    chunk: async (route) => {
      const i = ++n;
      await new Promise((r) => setTimeout(r, 200)); // let the generating step linger so X/N is observable
      await route.fulfill({ json: { cards: [{ front: `Q${i}`, back: `A${i}`, card_type: "basic", citation: `Section ${i}` }] } });
    },
  });
  await pasteText(page, multiChunkText());

  const download = page.waitForEvent("download");
  await generate(page);

  await expect(page.getByText(/Generating cards \d+\/\d+/)).toBeVisible();
  expect((await download).suggestedFilename()).toBe("deck.apkg");
  await expect(page.getByText("Deck downloaded")).toBeVisible();
});

test("one chunk fails both attempts → partial note, deck still downloads", async ({ page }) => {
  await stub(page, {
    // Fail by body content → the same chunk fails on its primary call AND its retry.
    chunk: (route) => {
      const { chunk } = JSON.parse(route.request().postData() || "{}");
      return chunk.includes(FAIL_MARKER)
        ? route.fulfill({ status: 500, json: { error: "boom" } })
        : okChunk(route);
    },
    finalize: (route) =>
      route.fulfill({
        contentType: "application/octet-stream",
        headers: { "content-disposition": 'attachment; filename="deck.apkg"', "x-card-count": "3" },
        body: Buffer.from("PK\x03\x04 stub"),
      }),
  });
  await pasteText(page, multiChunkText(true));

  const download = page.waitForEvent("download");
  await generate(page);

  await download; // the surviving chunks still produced a downloadable deck
  await expect(page.getByText(/section.*failed.*regenerate/i)).toBeVisible();
  await expect(page.getByText("Deck downloaded")).toBeVisible();
});

test("all chunks fail → styled generation error, no download", async ({ page }) => {
  await stub(page, { chunk: (route) => route.fulfill({ status: 500, json: { error: "boom" } }) });
  await pasteText(page, multiChunkText());
  await generate(page);

  await expect(page.getByText("Something went wrong")).toBeVisible();
  await expect(page.getByText("Deck downloaded")).toHaveCount(0);
});

test("deck/start 429 → UpgradeModal (limit)", async ({ page }) => {
  await stub(page, { deckStart: (route) => route.fulfill({ status: 429, json: { error: "limit" } }) });
  await pasteText(page, multiChunkText());
  await generate(page);

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/used your 5 free decks/i)).toBeVisible();
});

test("deck/start 400 characters → UpgradeModal (characters)", async ({ page }) => {
  await stub(page, { deckStart: (route) => route.fulfill({ status: 400, json: { error: "characters" } }) });
  await pasteText(page, multiChunkText());
  await generate(page);

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/exceeds the free limit/i)).toBeVisible();
});

test("cancel aborts generation → returns to idle, no download or error", async ({ page }) => {
  await stub(page, {
    chunk: async (route) => {
      await new Promise((r) => setTimeout(r, 8000)); // hang at the generating step
      try { await route.fulfill({ json: { cards: [] } }); } catch { /* request aborted by cancel */ }
    },
  });
  await pasteText(page, multiChunkText());
  await generate(page);

  // Exercises the cutover's abort wiring (AbortController → in-flight chunk
  // fetches reject → idle). A real .click() — not dispatchEvent — because the
  // cutover gives the Cancel button pointer-events-auto, overriding the busy
  // panel's pointer-events-none. So this also guards the fix: if Cancel ever
  // loses pointer events again, Playwright's actionability check fails here.
  const cancel = page.getByRole("button", { name: /Cancel/ });
  await expect(cancel).toBeVisible();
  await cancel.click();

  await expect(page.getByRole("button", { name: "Generate" })).toBeVisible();
  await expect(page.getByText("Deck downloaded")).toHaveCount(0);
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
});
