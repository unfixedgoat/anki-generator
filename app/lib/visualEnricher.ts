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

// Wikimedia's User-Agent policy asks every client to identify itself with a
// descriptive UA + contact; requests sent with a generic/absent UA (Node's
// default) get aggressively rate-limited, which silently drops images when a
// deck enriches several cards at once. Send a real one on every upstream call.
// https://meta.wikimedia.org/wiki/User-Agent_policy
const WIKIMEDIA_HEADERS = {
  "User-Agent": "HighYieldCards/3.0 (https://highyield.cards; support@highyield.cards) card-image-enrichment",
} as const;

async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: WIKIMEDIA_HEADERS, signal: AbortSignal.timeout(8000) });
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

function isAcceptableImageUrl(url: string): boolean {
  const filename = (url.split("/").pop() ?? "").toLowerCase();
  if (filename.endsWith(".gif")) return false;
  if (FILENAME_REJECT.some(w => filename.includes(w))) return false;
  return true;
}

// A JPEG lead image is almost always a photograph (e.g. the "Carbon" article's
// graphite-and-diamond photo), whereas the diagrams we want are SVG — served by
// the pageimages API as a rendered ".svg.png" — or native PNG illustrations.
// We use this to keep photos off cards unless nothing better exists.
function isPhotoUrl(url: string): boolean {
  const filename = (url.split("/").pop() ?? "").toLowerCase();
  return filename.endsWith(".jpg") || filename.endsWith(".jpeg");
}

// Fold the common British/American spelling split so a query word like
// "hybridization" matches Wikipedia's article title "Orbital hybridisation".
// Without this, the s/z difference silently discards the single most relevant
// article and the relevance filter falls through to a generic one.
function normalizeForMatch(word: string): string {
  return word
    .toLowerCase()
    .replace(/isation\b/g, "ization")
    .replace(/ise\b/g, "ize")
    .replace(/yse\b/g, "yze");
}

// Two words "match" if one contains the other after spelling normalization, or
// if they share a ≥6-char prefix (catches residual inflection/spelling drift
// like "hybridization"/"hybridisation" that survives the fold above).
function wordsMatch(a: string, b: string): boolean {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const min = Math.min(na.length, nb.length);
  if (min < 6) return false;
  let i = 0;
  while (i < min && na[i] === nb[i]) i++;
  return i >= 6;
}

function titleMatchesQueryWord(title: string, queryWord: string): boolean {
  const titleWords = title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return titleWords.some(tw => wordsMatch(tw, queryWord));
}

// A single matched word this long is discriminative enough to stand on its own
// (e.g. "hybridization", "mitochondria", "glomerulus") — as opposed to a broad
// subject noun like "carbon" or "neuron" that many off-topic articles share.
const SPECIFIC_WORD_LEN = 10;

interface TitleOverlap {
  score: number; // sum of matched query-word lengths — a specificity proxy
  count: number; // number of distinct query words matched
  longest: number; // length of the longest matched query word
}

function scoreTitleOverlap(title: string, queryWords: string[]): TitleOverlap {
  let score = 0;
  let count = 0;
  let longest = 0;
  for (const qw of queryWords) {
    if (titleMatchesQueryWord(title, qw)) {
      score += qw.length;
      count += 1;
      if (qw.length > longest) longest = qw.length;
    }
  }
  return { score, count, longest };
}

// A candidate is specific enough to accept even when it isn't the top match if
// it shares two or more query words, or one long discriminative word. A lone
// generic-subject match (just "carbon") is not — for those we prefer to fall
// through to the Commons file-search rather than serve a loosely related article.
function isSpecificMatch(o: TitleOverlap): boolean {
  return o.count >= 2 || o.longest >= SPECIFIC_WORD_LEN;
}

const BIAS_TERMS = ["diagram", "pathway", "structure", "cycle"];

// Commons file-search returns whatever media matches the term text — including
// scanned PDFs, audio, and video whose thumbnails would be useless on a card.
// Gate hard on real raster/vector image MIME types.
const OK_IMAGE_MIME = new Set(["image/svg+xml", "image/png", "image/jpeg"]);

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

// Public entry point: try the article lead-image path first (high precision —
// it rides on Wikipedia's own choice of the article's representative image),
// then fall back to a direct Commons File-namespace search for concepts that
// have no article lead image but do have a standalone diagram file on Commons
// (e.g. "afferent arteriole" → Renal_corpuscle.svg).
export async function fetchWikimediaUrl(
  searchTerm: string,
  fetcher: Fetcher = fetch
): Promise<string | null> {
  const fromArticle = await fetchArticlePageImage(searchTerm, fetcher);
  if (fromArticle) return fromArticle;
  return fetchCommonsFileImage(searchTerm, fetcher);
}

async function fetchArticlePageImage(
  searchTerm: string,
  fetcher: Fetcher
): Promise<string | null> {
  try {
    const biasedTerm = BIAS_TERMS.some(t => searchTerm.toLowerCase().includes(t))
      ? searchTerm
      : `${searchTerm} diagram`;
    // Fetch the top 5 results so we have fallbacks if the first is irrelevant.
    const searchUrl =
      `https://en.wikipedia.org/w/api.php?action=query&list=search` +
      `&srsearch=${encodeURIComponent(biasedTerm)}&srnamespace=0&srlimit=5` +
      `&format=json&origin=*`;
    const searchRes = await fetcher(searchUrl, { headers: WIKIMEDIA_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json() as {
      query?: { search?: { title: string }[] };
    };
    const results = searchData?.query?.search;
    if (!results?.length) return null;

    // Score each result by how specifically its title overlaps the query, then
    // rank best-first. Matching is spelling-tolerant ("hybridization" matches
    // "hybridisation"), and dropping films/companies/disambiguation pages first.
    // Array.sort is stable, so equal scores keep Wikipedia's own search rank.
    const queryWords = searchTerm.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const candidates = results
      .map(r => ({ title: r.title, ...scoreTitleOverlap(r.title, queryWords) }))
      .filter(c => {
        const tl = c.title.toLowerCase();
        if (SKIP_SUFFIXES.some(s => tl.endsWith(s.toLowerCase()))) return false;
        return queryWords.length === 0 || c.score > 0;
      })
      .sort((a, b) => b.score - a.score);

    if (!candidates.length) return null;

    const topScore = candidates[0].score;

    // Batch-fetch thumbnails for all candidates in a single API call.
    // Each title must be encoded separately; joining with a literal "|" keeps the
    // Wikipedia API pipe-separator intact (encodeURIComponent("|") would break it).
    const titlesParam = candidates.map(c => encodeURIComponent(c.title)).join("|");
    const thumbUrl =
      `https://en.wikipedia.org/w/api.php?action=query&titles=${titlesParam}` +
      `&prop=pageimages&pithumbsize=800&pilicense=any&format=json&origin=*`;
    const thumbRes = await fetcher(thumbUrl, { headers: WIKIMEDIA_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!thumbRes.ok) return null;
    const thumbData = await thumbRes.json() as {
      query?: { pages?: Record<string, { title?: string; thumbnail?: { source: string } }> };
    };
    const pages = thumbData?.query?.pages;
    if (!pages) return null;

    const thumbFor = (title: string): string | undefined =>
      Object.values(pages).find(p => p.title?.toLowerCase() === title.toLowerCase())
        ?.thumbnail?.source;

    // A candidate is worth returning only if it's the strongest match we found
    // (the best article for the query) or independently specific. This stops the
    // search from rank-walking past a strong match that happens to lack a lead
    // image (e.g. "Orbital hybridisation") down to a weak generic one ("Allotropes
    // of carbon") — in that case we return null and let the Commons file-search
    // fallback try instead.
    const eligible = candidates.filter(c => c.score === topScore || isSpecificMatch(c));

    // Pass 1 — diagrams: first eligible candidate with a non-photographic thumbnail.
    for (const c of eligible) {
      const src = thumbFor(c.title);
      if (src && isAcceptableImageUrl(src) && !isPhotoUrl(src)) return src;
    }
    // Pass 2 — photos as a last resort, but only for specific matches, never a
    // lone generic one (keeps the graphite/diamond photo off an sp³ card).
    for (const c of eligible) {
      if (!isSpecificMatch(c)) continue;
      const src = thumbFor(c.title);
      if (src && isAcceptableImageUrl(src)) return src;
    }
    return null;
  } catch {
    return null;
  }
}

// Drop the term down to its first `n` words. The model emits deliberately
// verbose academic search terms (e.g. "afferent arteriole glomerulus blood
// flow") to disambiguate the article search — but on Commons file-search those
// extra words match unrelated scanned documents, so the core noun phrase finds
// the diagram where the full string finds nothing.
function firstWords(term: string, n: number): string {
  return term.trim().split(/\s+/).slice(0, n).join(" ");
}

async function commonsFileQuery(
  term: string,
  fetcher: Fetcher
): Promise<string | null> {
  // filetype:bitmap|drawing restricts the search to raster/vector images at the
  // API level, excluding PDFs, audio, and video that would otherwise outrank the
  // diagrams for medical terms. OK_IMAGE_MIME is the belt-and-suspenders gate.
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search` +
    `&gsrsearch=${encodeURIComponent(`filetype:bitmap|drawing ${term}`)}` +
    `&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|mime&iiurlwidth=800` +
    `&format=json&origin=*`;
  const res = await fetcher(url, { headers: WIKIMEDIA_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        { index?: number; imageinfo?: { thumburl?: string; url?: string; mime?: string }[] }
      >;
    };
  };
  const pages = data?.query?.pages;
  if (!pages) return null;

  // generator=search tags each page with `index` for its search rank; sort by
  // it so we return the top-ranked acceptable image, not a hash-map-order one.
  const ranked = Object.values(pages).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const page of ranked) {
    const info = page.imageinfo?.[0];
    const src = info?.thumburl ?? info?.url;
    if (!src || !info?.mime || !OK_IMAGE_MIME.has(info.mime)) continue;
    if (isAcceptableImageUrl(src)) return src;
  }
  return null;
}

async function fetchCommonsFileImage(
  searchTerm: string,
  fetcher: Fetcher
): Promise<string | null> {
  try {
    // Try the term as given, then a trimmed core phrase. Dedupe so a term that
    // is already ≤3 words costs exactly one request.
    const variants = [...new Set([searchTerm.trim(), firstWords(searchTerm, 3)])];
    for (const variant of variants) {
      if (!variant) continue;
      const url = await commonsFileQuery(variant, fetcher);
      if (url) return url;
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

// Cap on how many cards we enrich (fetch remote images for) at once. Each
// enriched card can fan out to several Wikipedia/Commons/mermaid/quickchart
// requests, so firing an entire deck concurrently can trip upstream rate limits
// and silently drop images. A small pool keeps the burst polite while still
// overlapping the network waits.
const ENRICH_CONCURRENCY = 6;

// Order-preserving bounded-concurrency map: at most `limit` workers run at once,
// and each result is written back to its original index so output order matches
// input order regardless of which cards finish first.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(workers);
  return results;
}

export async function enrichCards(cards: RawCard[]): Promise<EnrichedCard[]> {
  return mapWithConcurrency(cards, ENRICH_CONCURRENCY, async ({ visual_type, visual_data, back, ...rest }) => {
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
  });
}
