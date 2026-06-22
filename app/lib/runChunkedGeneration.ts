import { chunkText } from "@/app/lib/chunkText";
import type { RawCard } from "@/app/lib/visualEnricher";

// Max chunk requests in flight at once. Each in-flight chunk is one Gemini call
// and one server-side burst-limiter tick; 3 clears a 25-chunk Pro deck without
// tripping the server's 50-req/60s burst fuse, even with one retry per chunk.
const CONCURRENCY = 3;

// Thrown when /api/deck/start refuses the spend up front: 429 → "limit" (deck
// quota exhausted), 400 {characters} → "characters" (over the char cap). The
// caller decides how to surface it (DropZone opens the UpgradeModal); this
// module never references any UI.
export class UpgradeNeededError extends Error {
  readonly reason: "limit" | "characters";
  constructor(reason: "limit" | "characters") {
    super(`upgrade-needed:${reason}`);
    this.name = "UpgradeNeededError";
    this.reason = reason;
  }
}

// Thrown when NOT ONE chunk produced cards, so no deck can be built. Distinct
// from a partial failure, which resolves normally with failedCount > 0 and a
// real deck. Mirrors the old inline copy: all-failed → the 502 message,
// all-empty → the 422 message.
export class GenerationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationFailedError";
  }
}

export interface RunChunkedGenerationInput {
  text: string;
  deckName: string;
  style: string;
  density: string;
  customPrompt: string;
  isPaste?: boolean;
}

export interface RunChunkedGenerationOptions {
  // Reports primary-pass chunk progress: completed goes 0 (fan-out start) up to
  // total (all chunks done). completed === total is the signal that generation
  // finished and finalize is next, so the caller can flip to a "packaging"
  // state. The single retry pass intentionally does NOT report progress.
  onProgress?: (completed: number, total: number) => void;
  signal?: AbortSignal;
}

export interface RunChunkedGenerationResult {
  blob: Blob;
  filename: string;
  cardCount: number;
  failedCount: number;
}

// Behavior-preserving extraction of DropZone's per-chunk orchestration core:
// deck/start (spend authority — char cap, one-time quota decrement, signed
// token) → generate/chunk × N in CONCURRENCY-capped batches (document order
// preserved, ≤1 retry per failed chunk, 2s backoff if a burst-429 was seen) →
// client merge → finalize (enrich + .apkg build). Pure: no React, no DOM, no UI.
// The four routes are called byte-for-byte as DropZone called them inline.
//
// Partial failure RESOLVES (failedCount > 0, deck still built); only fatal
// conditions throw — UpgradeNeededError (deck/start refusal), GenerationFailedError
// (nothing survived), or an AbortError (caller aborted via signal). The caller
// owns the download trigger and all UI surfacing.
export async function runChunkedGeneration(
  { text, deckName, style, density, customPrompt, isPaste = false }: RunChunkedGenerationInput,
  { onProgress, signal }: RunChunkedGenerationOptions = {}
): Promise<RunChunkedGenerationResult> {
  // SAME 12k config as the proven server path — do not change.
  const chunks = chunkText(text, 12000);

  // 1. Pre-flight gate. deck/start is the authority on the char cap and the
  // one-time quota decrement; it mints the signed token the other routes verify.
  const startRes = await fetch("/api/deck/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalChars: text.length, chunks: chunks.length }),
    signal,
  });
  if (startRes.status === 400) {
    const data = await startRes.json().catch(() => ({}));
    if (data?.error === "characters") throw new UpgradeNeededError("characters");
    throw new Error("Couldn't start generation. Please try again.");
  }
  if (startRes.status === 429) throw new UpgradeNeededError("limit");
  if (!startRes.ok) throw new Error("Couldn't start generation. Please try again.");
  const { token } = (await startRes.json()) as { token: string };

  // 2. Fan out chunks in capped concurrent batches, preserving document order.
  onProgress?.(0, chunks.length);

  const cardsByIndex: (RawCard[] | null)[] = new Array(chunks.length).fill(null);
  let processed = 0;
  let burstSeen = false;

  const runChunk = async (idx: number): Promise<void> => {
    const res = await fetch("/api/generate/chunk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, chunk: chunks[idx], style, density, customPrompt, isPaste }),
      signal,
    });
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      // The client tripped its own fuse — shouldn't happen at CONCURRENCY 3
      // on a legitimate deck. Flag it so the retry pass backs off first.
      if (data?.error === "burst") { burstSeen = true; throw new Error("burst"); }
      throw new Error("rate");
    }
    if (!res.ok) throw new Error(`chunk ${res.status}`);
    const data = (await res.json()) as { cards: RawCard[] };
    cardsByIndex[idx] = data.cards ?? [];
  };

  // One batched pass over a set of chunk indices; returns those still failed.
  // Promise.allSettled means one bad chunk never nukes the deck.
  const runPass = async (indices: number[], countProgress: boolean): Promise<number[]> => {
    const failed: number[] = [];
    for (let i = 0; i < indices.length; i += CONCURRENCY) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const batch = indices.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(batch.map((idx) => runChunk(idx)));
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      settled.forEach((r, b) => {
        if (r.status === "rejected") failed.push(batch[b]);
        if (countProgress) {
          processed++;
          onProgress?.(processed, chunks.length);
        }
      });
    }
    return failed;
  };

  // Primary pass over every chunk, then at most ONE retry pass for failures
  // (a retry is another burst-counted call, so it's capped hard at one).
  let failedIdx = await runPass(chunks.map((_, i) => i), true);
  if (failedIdx.length > 0) {
    if (burstSeen) await new Promise((r) => setTimeout(r, 2000));
    failedIdx = await runPass(failedIdx, false);
  }

  const merged = cardsByIndex.filter((c): c is RawCard[] => c !== null).flat();
  const failedCount = failedIdx.length;

  if (merged.length === 0) {
    // Nothing survived. All-failed mirrors the old 502; all-empty the 422.
    throw new GenerationFailedError(
      failedCount === chunks.length
        ? "Card generation failed. Please try again."
        : "No flashcards could be generated from this document."
    );
  }

  // 3. Finalize: enrich + build the .apkg server-side, stream back the binary.
  const finalizeRes = await fetch("/api/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, deckName, cards: merged, style, density }),
    signal,
  });
  if (!finalizeRes.ok) {
    const data = await finalizeRes.json().catch(() => null);
    const code = data?.error;
    throw new Error(
      code && code !== "token" && code !== "invalid"
        ? String(code)
        : "Card generation failed. Please try again."
    );
  }
  const disposition = finalizeRes.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? "anki_deck.apkg";
  const cardCount = parseInt(finalizeRes.headers.get("X-Card-Count") ?? String(merged.length), 10);
  const blob = await finalizeRes.blob();

  return { blob, filename, cardCount, failedCount };
}
