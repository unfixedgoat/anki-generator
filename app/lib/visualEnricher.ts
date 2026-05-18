export type VisualType = "mermaid" | "quickchart" | "wikimedia" | "none";

export interface RawCard {
  front: string;
  back: string;
  card_type: string;
  citation: string;
  visual_type?: VisualType;
  visual_data?: string;
}

export interface EnrichedCard extends Omit<RawCard, "visual_type" | "visual_data"> {
  visual_url?: string;
}

function buildVisualUrl(type: "mermaid" | "quickchart", data: string): string {
  if (type === "mermaid") {
    const encoded = Buffer.from(data, "utf-8").toString("base64");
    return `https://mermaid.ink/img/${encoded}`;
  }
  return `https://quickchart.io/chart?c=${encodeURIComponent(data)}`;
}

const MAX_IMAGE_BYTES = 400_000; // 400 KB — keeps base64 overhead within response limits

async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) return null;
    const contentLength = Number(res.headers.get("content-length") ?? 0);
    if (contentLength > MAX_IMAGE_BYTES) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) return null;
    const b64 = Buffer.from(buf).toString("base64");
    return `data:${contentType};base64,${b64}`;
  } catch {
    return null;
  }
}

// Suffixes that indicate a Wikipedia disambiguation or non-academic article.
// We skip any result whose title ends with one of these.
const SKIP_SUFFIXES = [
  " (film)", " (movie)", " (TV series)", " (series)", " (album)", " (song)",
  " (band)", " (company)", " (brand)", " (disambiguation)", " (novel)",
  " (video game)", " (game)", " (character)", " (comics)",
];

const FILENAME_REJECT = [
  "flag", "coat", "arms", "logo", "icon", "portrait", "photo", "map_of",
  "locator", "seal", "emblem", "crest", "person", "people", "building", "landscape",
];
const FILENAME_REQUIRE = [
  "diagram", "scheme", "pathway", "structure", "cycle", "receptor", "channel",
  "cell", "membrane", "synapse", "pump", "protein", "molecule", "anatomy",
  "cross", "section", "illustration", "fig", "chart", "graph", "svg",
];

function isAcceptableImageUrl(url: string): boolean {
  const filename = (url.split("/").pop() ?? "").toLowerCase();
  if (filename.endsWith(".gif")) return false;
  if (FILENAME_REJECT.some(w => filename.includes(w))) return false;
  if (!FILENAME_REQUIRE.some(w => filename.includes(w))) return false;
  return true;
}

const BIAS_TERMS = ["diagram", "pathway", "structure", "cycle"];

async function fetchWikimediaUrl(searchTerm: string): Promise<string | null> {
  try {
    const biasedTerm = BIAS_TERMS.some(t => searchTerm.toLowerCase().includes(t))
      ? searchTerm
      : `${searchTerm} diagram`;
    // Fetch the top 5 results so we have fallbacks if the first is irrelevant.
    const searchUrl =
      `https://en.wikipedia.org/w/api.php?action=query&list=search` +
      `&srsearch=${encodeURIComponent(biasedTerm)}&srnamespace=0&srlimit=5` +
      `&format=json&origin=*`;
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json() as {
      query?: { search?: { title: string }[] };
    };
    const results = searchData?.query?.search;
    if (!results?.length) return null;

    // Filter out obvious non-academic hits (films, companies, disambiguation pages).
    const queryWords = searchTerm.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const candidates = results.filter(r => {
      const tl = r.title.toLowerCase();
      if (SKIP_SUFFIXES.some(s => tl.endsWith(s.toLowerCase()))) return false;
      // Keep the result if its title shares at least one significant word with the query.
      return queryWords.length === 0 || queryWords.some(w => tl.includes(w));
    });

    if (!candidates.length) return null;

    // Batch-fetch thumbnails for all candidates in a single API call.
    // Each title must be encoded separately; joining with a literal "|" keeps the
    // Wikipedia API pipe-separator intact (encodeURIComponent("|") would break it).
    const titlesParam = candidates.map(r => encodeURIComponent(r.title)).join("|");
    const thumbUrl =
      `https://en.wikipedia.org/w/api.php?action=query&titles=${titlesParam}` +
      `&prop=pageimages&pithumbsize=800&pilicense=any&format=json&origin=*`;
    const thumbRes = await fetch(thumbUrl, { signal: AbortSignal.timeout(8000) });
    if (!thumbRes.ok) return null;
    const thumbData = await thumbRes.json() as {
      query?: { pages?: Record<string, { title?: string; thumbnail?: { source: string } }> };
    };
    const pages = thumbData?.query?.pages;
    if (!pages) return null;

    // Return the first candidate (in original search-rank order) that has a thumbnail
    // passing filename validation.
    for (const candidate of candidates) {
      const page = Object.values(pages).find(
        p => p.title?.toLowerCase() === candidate.title.toLowerCase()
      );
      if (page?.thumbnail?.source && isAcceptableImageUrl(page.thumbnail.source)) {
        return page.thumbnail.source;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveVisual(
  type: VisualType,
  data: string
): Promise<{ dataUri: string; sourceUrl: string } | null> {
  if (type === "wikimedia") {
    const imageUrl = await fetchWikimediaUrl(data);
    if (!imageUrl) return null;
    const dataUri = await fetchAsDataUri(imageUrl);
    if (!dataUri) return null;
    return { dataUri, sourceUrl: imageUrl };
  }

  if (type === "mermaid" || type === "quickchart") {
    const url = buildVisualUrl(type, data);
    const dataUri = await fetchAsDataUri(url);
    if (!dataUri) return null;
    return { dataUri, sourceUrl: url };
  }

  return null;
}

export async function enrichCards(cards: RawCard[]): Promise<EnrichedCard[]> {
  return Promise.all(
    cards.map(async ({ visual_type, visual_data, back, ...rest }) => {
      const effectiveType = visual_type ?? "none";

      if (effectiveType !== "none" && visual_data?.trim()) {
        const result = await resolveVisual(effectiveType, visual_data.trim());
        if (result) {
          return {
            ...rest,
            back: `${back}<br/><img src="${result.dataUri}" alt="visual" style="max-width:100%;margin-top:0.75em;" />`,
            visual_url: result.sourceUrl,
          };
        }
      }

      return { ...rest, back };
    })
  );
}
