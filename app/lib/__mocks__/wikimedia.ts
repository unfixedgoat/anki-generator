type MockFetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface MockEntry {
  searchTitle: string | null;
  imageFilename: string | null;
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

    throw new Error(`Unexpected URL in wikimedia mock: ${url}`);
  };
}
