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

export function enrichCards(cards: RawCard[]): EnrichedCard[] {
  return cards.map(({ visual_type, visual_data, back, ...rest }) => {
    const effectiveType = visual_type ?? "none";

    if (effectiveType !== "none" && visual_data?.trim()) {
      const url = buildVisualUrl(effectiveType, visual_data.trim());
      if (url) {
        return {
          ...rest,
          back: `${back}<br/><img src="${url}" alt="visual" style="max-width:100%;margin-top:0.75em;" />`,
          visual_url: url,
        };
      }
    }

    return { ...rest, back };
  });
}
