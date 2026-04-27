export type VisualType = "mermaid" | "quickchart" | "none";

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

function buildVisualUrl(type: VisualType, data: string): string | null {
  if (type === "mermaid") {
    const encoded = Buffer.from(data, "utf-8").toString("base64");
    return `https://mermaid.ink/img/${encoded}`;
  }

  if (type === "quickchart") {
    const encoded = encodeURIComponent(data);
    return `https://quickchart.io/chart?c=${encoded}`;
  }

  return null;
}

async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    return `data:${contentType};base64,${b64}`;
  } catch {
    return null;
  }
}

export async function enrichCards(cards: RawCard[]): Promise<EnrichedCard[]> {
  return Promise.all(
    cards.map(async ({ visual_type, visual_data, back, ...rest }) => {
      const effectiveType = visual_type ?? "none";

      if (effectiveType !== "none" && visual_data?.trim()) {
        const url = buildVisualUrl(effectiveType, visual_data.trim());
        if (url) {
          const dataUri = await fetchAsDataUri(url);
          if (dataUri) {
            return {
              ...rest,
              back: `${back}<br/><img src="${dataUri}" alt="visual" style="max-width:100%;margin-top:0.75em;" />`,
              visual_url: url,
            };
          }
        }
      }

      return { ...rest, back };
    })
  );
}
