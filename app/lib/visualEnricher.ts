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

async function fetchWikimediaUrl(searchTerm: string): Promise<string | null> {
  try {
    // Search English Wikipedia articles, then fetch the primary page thumbnail.
    // This avoids File-namespace results which are Commons images that may have
    // non-English labels baked into the graphic.
    const searchUrl =
      `https://en.wikipedia.org/w/api.php?action=query&list=search` +
      `&srsearch=${encodeURIComponent(searchTerm)}&srnamespace=0&srlimit=3` +
      `&format=json&origin=*`;
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json() as {
      query?: { search?: { title: string }[] };
    };
    const results = searchData?.query?.search;
    if (!results?.length) return null;

    const pageTitle = results[0].title;
    const thumbUrl =
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}` +
      `&prop=pageimages&pithumbsize=800&pilicense=any&format=json&origin=*`;
    const thumbRes = await fetch(thumbUrl, { signal: AbortSignal.timeout(8000) });
    if (!thumbRes.ok) return null;
    const thumbData = await thumbRes.json() as {
      query?: { pages?: Record<string, { thumbnail?: { source: string } }> };
    };
    const pages = thumbData?.query?.pages;
    if (!pages) return null;
    const page = pages[Object.keys(pages)[0]];
    return page?.thumbnail?.source ?? null;
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
