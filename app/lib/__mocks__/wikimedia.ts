type MockFetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface MockEntry {
  searchTitle: string | null;
  imageFilename: string | null;
  // Filename returned by the Commons File-namespace fallback search. Only
  // reached when the article pageimage path yields nothing. Omit → fallback
  // finds nothing (the common negative case).
  commonsFilename?: string | null;
  commonsMime?: string;
}

const MOCK_DATA: Record<string, MockEntry> = {
  "Circle of Willis diagram": {
    searchTitle: "Circle of Willis",
    imageFilename: "Circle_of_Willis_en.svg",
  },
  "Glitter ball": {
    searchTitle: "Glitter ball",
    imageFilename: "Glitter_ball_42.jpg",
  },
  "Mitochondria structure": {
    searchTitle: "Mitochondria",
    imageFilename: "Mitochondria_diagram.png",
  },
  "Frog cartoon": {
    searchTitle: "Frog cartoon",
    imageFilename: "Frog_cartoon.gif",
  },
  "Nonexistent term xyz": {
    searchTitle: null,
    imageFilename: null,
  },
  "Country flag France": {
    searchTitle: "Flag of France",
    imageFilename: "Flag_of_France.svg",
  },
  "Blausen neuron": {
    searchTitle: "Multipolar neuron",
    imageFilename: "Blausen_0657_MultipolarNeuron.png",
  },
  "Gray hippocampus": {
    searchTitle: "Hippocampus",
    imageFilename: "Gray739-hippocampus.png",
  },
  // Article search finds an article but it has no usable lead image, so the
  // Commons File-namespace fallback fires and recovers a standalone diagram.
  "afferent arteriole glomerulus blood flow": {
    searchTitle: "Afferent arterioles",
    imageFilename: null,
    commonsFilename: "Renal_corpuscle.svg.png",
    commonsMime: "image/svg+xml",
  },
  // Fallback returns only a PDF scan (wrong MIME) → must be rejected → null.
  "juxtaglomerular apparatus renin release": {
    searchTitle: "Juxtaglomerular apparatus",
    imageFilename: null,
    commonsFilename: "page1-960px-Navy_Medical_News.pdf.jpg",
    commonsMime: "application/pdf",
  },
};

function makeJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function mockWikimediaResponse(searchTerm: string): MockFetcher {
  const entry = MOCK_DATA[searchTerm];
  if (!entry) throw new Error(`No mock data registered for: "${searchTerm}"`);

  return async (url: string): Promise<Response> => {
    if (url.includes("list=search")) {
      if (entry.searchTitle === null) {
        return makeJsonResponse({ query: { search: [] } });
      }
      return makeJsonResponse({ query: { search: [{ title: entry.searchTitle }] } });
    }

    if (url.includes("prop=pageimages")) {
      if (!entry.searchTitle || !entry.imageFilename) {
        return makeJsonResponse({ query: { pages: {} } });
      }
      const imageUrl =
        `https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/${entry.imageFilename}`;
      return makeJsonResponse({
        query: {
          pages: {
            "1": {
              title: entry.searchTitle,
              thumbnail: { source: imageUrl },
            },
          },
        },
      });
    }

    // Commons File-namespace fallback (generator=search over namespace 6).
    if (url.includes("gsrnamespace=6")) {
      if (!entry.commonsFilename) {
        return makeJsonResponse({ query: { pages: {} } });
      }
      const fileUrl =
        `https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/${entry.commonsFilename}`;
      return makeJsonResponse({
        query: {
          pages: {
            "100": {
              index: 1,
              imageinfo: [{ thumburl: fileUrl, mime: entry.commonsMime ?? "image/png" }],
            },
          },
        },
      });
    }

    throw new Error(`Unexpected URL in wikimedia mock: ${url}`);
  };
}
