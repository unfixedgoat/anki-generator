import { fetchWikimediaUrl } from "../app/lib/visualEnricher";
import { mockWikimediaResponse } from "../app/lib/__mocks__/wikimedia";

interface TestCase {
  term: string;
  expectUrl: boolean;
  description: string;
}

const MOCK_CASES: TestCase[] = [
  {
    term: "Circle of Willis diagram",
    expectUrl: true,
    description: "valid SVG with required term in filename",
  },
  {
    term: "Blausen neuron",
    expectUrl: true,
    description: "Blausen_0657_MultipolarNeuron.png — no reject terms, passes without FILENAME_REQUIRE",
  },
  {
    term: "Gray hippocampus",
    expectUrl: true,
    description: "Gray739-hippocampus.png — no reject terms, passes without FILENAME_REQUIRE",
  },
  {
    term: "Mitochondria structure",
    expectUrl: true,
    description: "valid PNG with 'diagram' in filename",
  },
  {
    term: "Frog cartoon",
    expectUrl: false,
    description: "REJECTED — .gif extension",
  },
  {
    term: "Nonexistent term xyz",
    expectUrl: false,
    description: "REJECTED — empty search results",
  },
  {
    term: "Country flag France",
    expectUrl: false,
    description: "REJECTED — 'flag' in filename",
  },
  {
    term: "afferent arteriole glomerulus blood flow",
    expectUrl: true,
    description: "FALLBACK — no article lead image, Commons file-search recovers a diagram",
  },
  {
    term: "juxtaglomerular apparatus renin release",
    expectUrl: false,
    description: "FALLBACK REJECTED — Commons returns only a PDF scan (wrong MIME)",
  },
];

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function runMockCases() {
  console.log("=== Mock cases ===\n");

  for (const { term, expectUrl, description } of MOCK_CASES) {
    const fetcher = mockWikimediaResponse(term);
    const url = await fetchWikimediaUrl(term, fetcher);
    const label = `[${term}] ${description}`;

    if (expectUrl) {
      assert(url !== null, label, url === null ? "got null" : undefined);
    } else {
      assert(url === null, label, url !== null ? `got URL: ${url}` : undefined);
    }
  }
}

async function runLiveSmokeTest() {
  console.log("\n=== Live smoke test ===\n");

  // "Action potential" Wikipedia thumbnail changed to a .gif (filtered by design).
  // Mitochondrion has a stable SVG illustration that consistently passes the reject filter.
  const term = "mitochondrion anatomy diagram";
  process.stdout.write(`  Fetching "${term}" from Wikipedia... `);
  const url = await fetchWikimediaUrl(term);
  if (url !== null && url.startsWith("https://")) {
    console.log("ok");
    assert(true, `[${term}] live Wikipedia returned valid URL: ${url}`);
  } else {
    console.log("failed");
    assert(false, `[${term}] live Wikipedia returned valid URL`, `got: ${url}`);
  }

  // Fallback smoke: a term with no article lead image that Commons file-search
  // should still recover a real diagram for. Guards the fallback end-to-end.
  const fbTerm = "afferent arteriole glomerulus blood flow";
  process.stdout.write(`  Fetching "${fbTerm}" via Commons fallback... `);
  const fbUrl = await fetchWikimediaUrl(fbTerm);
  if (fbUrl !== null && fbUrl.startsWith("https://")) {
    console.log("ok");
    assert(true, `[${fbTerm}] Commons fallback returned valid URL: ${fbUrl}`);
  } else {
    console.log("failed");
    assert(false, `[${fbTerm}] Commons fallback returned valid URL`, `got: ${fbUrl}`);
  }
}

(async () => {
  await runMockCases();
  await runLiveSmokeTest();

  console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
