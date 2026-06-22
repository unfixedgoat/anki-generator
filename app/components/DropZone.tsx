"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Upload, CheckCircle2, AlertCircle, X } from "lucide-react";
import DensityToggle, { type Density } from "./DensityToggle";
import StyleToggle, { type CardStyle } from "./StyleToggle";
import UpgradeModal from "./UpgradeModal";
import { chunkText } from "@/app/lib/chunkText";
import type { RawCard } from "@/app/lib/visualEnricher";

type DropState = "idle" | "hovering" | "extracting" | "loading" | "success" | "error";
type InputType = "pdf" | "text";

export interface GenerationInfo {
  blob: Blob;
  filename: string;
  cardCount: number;
  density: Density;
  style: CardStyle;
  text: string;
}

interface Props {
  onGenerated?: (info: GenerationInfo) => void;
}

// Max chunk requests in flight at once. Each in-flight chunk is one Gemini call
// and one server-side burst-limiter tick; 3 clears a 25-chunk Pro deck without
// tripping the server's 50-req/60s burst fuse, even with one retry per chunk.
const CONCURRENCY = 3;

// deckName is built client-side now: the per-chunk path's /api/finalize takes it
// in the request body instead of deriving it server-side. Mirrors the old
// /api/generate logic exactly — base = filename without .pdf (or "pasted_text"),
// suffixed with a UTC minute stamp. /api/finalize re-sanitizes it for download.
function buildDeckName(filename: string | null): string {
  const base = filename?.replace(/\.pdf$/i, "") || "pasted_text";
  const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `${base} ${ts}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const STEPS: { label: string; n: 1 | 2 | 3 }[] = [
  { label: "Extracting text", n: 1 },
  { label: "Generating cards", n: 2 },
  { label: "Packaging deck", n: 3 },
];

export default function DropZone({ onGenerated }: Props) {
  const [inputType, setInputType] = useState<InputType>("pdf");
  const [state, setState] = useState<DropState>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [density, setDensity] = useState<Density>("high-yield");
  const [cardStyle, setCardStyle] = useState<CardStyle>("standard");
  const [customPrompt, setCustomPrompt] = useState("");
  const [rawText, setRawText] = useState("");
  const [loadingStep, setLoadingStep] = useState<1 | 2 | 3 | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [chunkProgress, setChunkProgress] = useState<{ done: number; total: number } | null>(null);
  const [partialNote, setPartialNote] = useState<string | null>(null);
  const [upgradeReason, setUpgradeReason] = useState<"limit" | "characters" | null>(null);
  const [identifier, setIdentifier] = useState("anonymous");
  const [isPro, setIsPro] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/whoami")
      .then((r) => r.json())
      .then((d) => setIdentifier(d.identifier ?? "anonymous"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setIsPro(!!d.isPro))
      .catch(() => {});
  }, []);

  const clientCharCap = isPro ? 300_000 : 50_000;
  const lastTextRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const step2TimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearProgressTimers = useCallback(() => {
    if (step2TimerRef.current) { clearTimeout(step2TimerRef.current); step2TimerRef.current = null; }
    if (elapsedIntervalRef.current) { clearInterval(elapsedIntervalRef.current); elapsedIntervalRef.current = null; }
  }, []);

  const startProgressSteps = useCallback(() => {
    clearProgressTimers();
    setLoadingStep(1);
    setElapsed(0);
    elapsedIntervalRef.current = setInterval(() => {
      setElapsed((e) => e + 1);
    }, 1000);
    step2TimerRef.current = setTimeout(() => {
      setLoadingStep((s) => (s === 1 ? 2 : s));
    }, 2000);
  }, [clearProgressTimers]);

  const switchMode = useCallback((mode: InputType) => {
    setInputType(mode);
    setState("idle");
    setFileName(null);
    setErrorMsg(null);
    setPartialNote(null);
  }, []);

  const handleDensityChange = useCallback((val: Density) => {
    setDensity(val);
  }, []);

  const handleStyleChange = useCallback((val: CardStyle) => {
    setCardStyle(val);
  }, []);

  const cancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    abortRef.current?.abort();
  }, []);

  // Orchestrates the per-chunk pipeline: deck/start (the spend authority) →
  // generate/chunk × N in capped concurrent batches → finalize. The client owns
  // the chunk merge, so it also owns partial-failure surfacing.
  const runChunkedGeneration = useCallback(
    // isPaste: true for pasted text, false for PDFs — mirrors the old route's
    // `isPaste = !filenameFromForm`. Threaded into every chunk body so the deck
    // gets the "Pasted text" (flag-only) vs section-style citation instruction.
    async (text: string, deckName: string, label: string, isPaste: boolean) => {
      setFileName(label);
      setErrorMsg(null);
      setPartialNote(null);
      setState("loading");
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      try {
        // SAME 12k config as the proven server path — do not change.
        const chunks = chunkText(text, 12000);

        // 1. Pre-flight gate. deck/start is the authority on the char cap and the
        // one-time quota decrement; the client pre-check above is only for speed.
        const startRes = await fetch("/api/deck/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ totalChars: text.length, chunks: chunks.length }),
          signal,
        });
        if (startRes.status === 400) {
          const data = await startRes.json().catch(() => ({}));
          if (data?.error === "characters") {
            clearProgressTimers();
            setLoadingStep(null);
            setState("idle");
            setFileName(null);
            setUpgradeReason("characters");
            return;
          }
          throw new Error("Couldn't start generation. Please try again.");
        }
        if (startRes.status === 429) {
          clearProgressTimers();
          setLoadingStep(null);
          setState("idle");
          setFileName(null);
          setUpgradeReason("limit");
          return;
        }
        if (!startRes.ok) throw new Error("Couldn't start generation. Please try again.");
        const { token } = (await startRes.json()) as { token: string };

        // 2. Fan out chunks in capped concurrent batches, preserving document order.
        setLoadingStep(2);
        setChunkProgress({ done: 0, total: chunks.length });

        const cardsByIndex: (RawCard[] | null)[] = new Array(chunks.length).fill(null);
        let processed = 0;
        let burstSeen = false;

        const runChunk = async (idx: number): Promise<void> => {
          const res = await fetch("/api/generate/chunk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, chunk: chunks[idx], style: cardStyle, density, customPrompt, isPaste }),
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
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");
            const batch = indices.slice(i, i + CONCURRENCY);
            const settled = await Promise.allSettled(batch.map((idx) => runChunk(idx)));
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");
            settled.forEach((r, b) => {
              if (r.status === "rejected") failed.push(batch[b]);
              if (countProgress) {
                processed++;
                setChunkProgress({ done: processed, total: chunks.length });
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
          throw new Error(
            failedCount === chunks.length
              ? "Card generation failed. Please try again."
              : "No flashcards could be generated from this document."
          );
        }

        // 3. Finalize: enrich + build the .apkg server-side, stream back the binary.
        setLoadingStep(3);
        setChunkProgress(null);
        const finalizeRes = await fetch("/api/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, deckName, cards: merged, style: cardStyle, density }),
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

        clearProgressTimers();
        triggerDownload(blob, filename);
        setLoadingStep(null);
        setState("success");
        setFileName(filename);

        // Partial-failure surfacing — non-blocking; the deck still downloaded.
        if (failedCount > 0) {
          setPartialNote(
            `Generated ${cardCount} cards. ${failedCount} section${failedCount === 1 ? "" : "s"} failed — you can regenerate for the full deck.`
          );
        }

        onGenerated?.({ blob, filename, cardCount, density, style: cardStyle, text });
      } catch (err) {
        clearProgressTimers();
        setLoadingStep(null);
        setChunkProgress(null);
        if (err instanceof Error && err.name === "AbortError") {
          setState("idle");
          setFileName(null);
          return;
        }
        setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
        setState("error");
      } finally {
        abortRef.current = null;
      }
    },
    [onGenerated, clearProgressTimers, cardStyle, density, customPrompt]
  );

  const processFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setErrorMsg("Only PDF files are accepted.");
        setState("error");
        return;
      }

      if (file.size > 30 * 1024 * 1024) {
        setErrorMsg("PDF too large (max 30 MB). Try splitting the document.");
        setState("error");
        return;
      }

      setFileName(file.name);
      setErrorMsg(null);
      setState("extracting");
      startProgressSteps();

      let text: string;
      try {
        const { extractTextFromPdf } = await import("@/app/lib/pdfExtract");
        text = await extractTextFromPdf(file);
      } catch (err) {
        clearProgressTimers();
        setLoadingStep(null);
        const name = err instanceof Error ? err.name : "";
        const msg  = err instanceof Error ? err.message : String(err);
        console.error("[pdfExtract]", msg);
        let userMsg: string;
        if (name === "PasswordException") {
          userMsg = "This PDF is password-protected. Remove the password and try again.";
        } else if (name === "InvalidPDFException") {
          userMsg = "This PDF couldn't be read. Try re-exporting it from the original application.";
        } else if (msg.includes("PDF library not ready")) {
          userMsg = "PDF reader not ready — wait a moment and try again.";
        } else {
          userMsg = "Couldn't extract text from this PDF. Try converting it to a new PDF using Preview or Adobe.";
        }
        setErrorMsg(userMsg);
        setState("error");
        return;
      }

      if (!text) {
        clearProgressTimers();
        setLoadingStep(null);
        setErrorMsg("This PDF contains scanned images with no text layer. Export a text-based version from your source and try again.");
        setState("error");
        return;
      }

      if (text.length > clientCharCap) {
        clearProgressTimers();
        setLoadingStep(null);
        setState("idle");
        setFileName(null);
        setUpgradeReason("characters");
        return;
      }

      lastTextRef.current = text;
      await runChunkedGeneration(text, buildDeckName(file.name), file.name, false);
    },
    [clientCharCap, runChunkedGeneration, startProgressSteps, clearProgressTimers]
  );

  const processText = useCallback(async () => {
    const text = rawText.trim();
    if (!text) return;
    if (text.length > clientCharCap) {
      setUpgradeReason("characters");
      return;
    }
    lastTextRef.current = text;
    startProgressSteps();
    await runChunkedGeneration(text, buildDeckName(null), "pasted text", true);
  }, [rawText, clientCharCap, runChunkedGeneration, startProgressSteps]);

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (state === "idle") setState("hovering");
    },
    [state]
  );

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setState((s) => (s === "hovering" ? "idle" : s));
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
      else setState("idle");
    },
    [processFile]
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const openPicker = useCallback(() => {
    if (state !== "loading" && state !== "extracting") {
      if (inputRef.current) inputRef.current.value = "";
      inputRef.current?.click();
    }
  }, [state]);

  const reset = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setState("idle");
    setFileName(null);
    setErrorMsg(null);
    setPartialNote(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const isHovering = state === "hovering";
  const isExtracting = state === "extracting";
  const isLoading = state === "loading";
  const isSuccess = state === "success";
  const isError = state === "error";
  const isIdle = state === "idle";
  const isBusy = isExtracting || isLoading;

  const StepsPanel = loadingStep !== null ? (
    <>
      <div className="flex flex-col gap-3">
        {STEPS.map(({ label, n }) => {
          const active = loadingStep === n;
          const done = loadingStep > n;
          return (
            <div key={n} className="flex items-center gap-3">
              {done ? (
                <div className="w-5 h-5 rounded-full bg-[#c97f1a] flex items-center justify-center flex-shrink-0">
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path
                      d="M1 4L3.5 6.5L9 1"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              ) : active ? (
                <div className="w-5 h-5 rounded-full bg-[#c97f1a] flex-shrink-0 animate-pulse" />
              ) : (
                <div className="w-5 h-5 rounded-full border border-slate-200 flex-shrink-0" />
              )}
              <span
                className={[
                  "text-sm",
                  active ? "text-[#7a4f0d] font-medium" : done ? "text-slate-400" : "text-slate-300",
                ].join(" ")}
              >
                {n === 2 && chunkProgress && chunkProgress.total > 1
                  ? `Generating cards ${chunkProgress.done}/${chunkProgress.total}`
                  : label}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-400">{elapsed}s</p>
      {loadingStep !== 3 && (
        <motion.button
          type="button"
          onClick={cancel}
          // pointer-events-auto: the busy-panel container sets pointer-events-none,
          // so without this override Cancel is unclickable for the full run — which
          // on the chunked path can be 2+ minutes on a large Pro doc.
          className="absolute bottom-5 flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-600 transition-colors tracking-widest uppercase pointer-events-auto"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
        >
          <X className="w-3 h-3" strokeWidth={2} />
          Cancel
        </motion.button>
      )}
    </>
  ) : null;

  const SuccessPanel = (
    <>
      <div className="w-10 h-10 rounded-full bg-[#c97f1a] flex items-center justify-center">
        <CheckCircle2 className="w-5 h-5 text-white" strokeWidth={1.5} />
      </div>
      <div className="text-center space-y-1.5">
        <p className="text-sm font-medium text-[#7a4f0d] font-serif">Deck downloaded</p>
        <p className="text-xs text-slate-400 max-w-xs truncate px-4">{fileName}</p>
      </div>
      {partialNote && (
        <p className="text-xs text-amber-600 max-w-xs px-4 leading-relaxed text-center">
          {partialNote}
        </p>
      )}
      <button
        type="button"
        onClick={() => window.open('https://tally.so/r/NpbkBW', '_blank')}
        className="text-xs text-[#7a4f0d] underline underline-offset-2 opacity-60 hover:opacity-100 block text-center mt-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#c97f1a] rounded"
      >
        Report a problem with this deck
      </button>
      <button
        type="button"
        onClick={reset}
        className="absolute bottom-5 text-[11px] text-slate-400 hover:text-slate-600 transition-colors tracking-widest uppercase"
      >
        Start over
      </button>
    </>
  );

  const ErrorPanel = (
    <>
      <AlertCircle className="w-8 h-8 text-red-600" strokeWidth={1.5} />
      <div className="text-center space-y-1.5">
        <p className="text-sm font-semibold text-red-700 tracking-wide">Something went wrong</p>
        <p className="text-xs text-slate-600 max-w-xs px-4 leading-relaxed">{errorMsg}</p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="absolute bottom-5 text-[11px] text-slate-400 hover:text-slate-600 transition-colors tracking-widest uppercase"
      >
        Try again
      </button>
    </>
  );

  return (
    <>
    <div className="flex flex-col items-center gap-5 w-full h-auto md:h-full">

      {/* Mode toggle */}
      <div className="bg-[#f5f3ee] rounded-full p-[3px] flex w-full select-none">
        <button
          type="button"
          onClick={() => switchMode("pdf")}
          className={[
            "relative flex-1 text-center py-[7px] rounded-full text-[11px]",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c97f1a] focus-visible:ring-offset-1 focus-visible:ring-offset-[#f5f3ee]",
            inputType === "pdf"
              ? "text-[#7a4f0d] font-medium"
              : "text-slate-400",
          ].join(" ")}
        >
          {inputType === "pdf" && (
            <motion.div
              layoutId="source-active-pill"
              className="absolute inset-0 bg-white rounded-full shadow-sm"
              transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.8 }}
            />
          )}
          <span className="relative z-10">Upload</span>
        </button>
        <button
          type="button"
          onClick={() => switchMode("text")}
          className={[
            "relative flex-1 text-center py-[7px] rounded-full text-[11px]",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c97f1a] focus-visible:ring-offset-1 focus-visible:ring-offset-[#f5f3ee]",
            inputType === "text"
              ? "text-[#7a4f0d] font-medium"
              : "text-slate-400",
          ].join(" ")}
        >
          {inputType === "text" && (
            <motion.div
              layoutId="source-active-pill"
              className="absolute inset-0 bg-white rounded-full shadow-sm"
              transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.8 }}
            />
          )}
          <span className="relative z-10">Paste</span>
        </button>
      </div>

      <DensityToggle value={density} onChange={handleDensityChange} disabled={isBusy} />
      <StyleToggle value={cardStyle} onChange={handleStyleChange} disabled={isBusy} />

      {/* Custom prompt box */}
      {cardStyle === "custom" && (
        <textarea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="Describe exactly how you want your cards formatted…"
          disabled={isBusy}
          className={[
            "w-full h-28 px-4 py-3 rounded-2xl border border-slate-200 bg-white",
            "text-sm text-slate-700 placeholder:text-slate-300",
            "resize-none focus:outline-none focus:border-slate-400",
            "leading-relaxed transition-colors duration-150",
            isBusy ? "opacity-40 pointer-events-none" : "",
          ].join(" ")}
        />
      )}

      {/* PDF drop zone */}
      {inputType === "pdf" && (
        <div
          role="button"
          tabIndex={isBusy ? -1 : 0}
          aria-label="Upload PDF"
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openPicker();
            }
          }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={[
            "relative flex flex-col items-center justify-center gap-5",
            "w-full min-h-[180px] md:flex-1 md:min-h-0 rounded-xl border-2 border-dashed",
            "transition-all duration-200 select-none outline-none",
            "focus-visible:ring-2 focus-visible:ring-[#c97f1a] focus-visible:ring-offset-2",
            isHovering
              ? "border-[#c97f1a] bg-[#fffdf7] scale-[1.01] cursor-copy"
              : isBusy
              ? "border-slate-200 bg-white cursor-default pointer-events-none"
              : isSuccess
              ? "border-[#f0c87a] bg-[#fef8ee] cursor-pointer"
              : isError
              ? "border-red-200 bg-red-50/30 cursor-pointer"
              : "border-[#f0c87a] bg-[#fffdf7] hover:border-[#c97f1a] cursor-pointer",
          ].join(" ")}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={onInputChange}
          />

          {isBusy && StepsPanel}
          {isSuccess && SuccessPanel}
          {isError && ErrorPanel}

          {(isIdle || isHovering) && (
            <>
              <Upload className="w-8 h-8 text-[#c97f1a]" strokeWidth={1.5} />
              <div className="text-center space-y-1.5">
                <p
                  className={[
                    "text-sm font-medium transition-colors duration-200",
                    isHovering ? "text-slate-700" : "text-slate-500",
                  ].join(" ")}
                >
                  {isHovering ? "Release to upload" : "Drop a PDF here"}
                </p>
                <p className="text-xs text-slate-400 tracking-wide">
                  or{" "}
                  <span className="text-[#7a4f0d] underline underline-offset-2 decoration-[#c97f1a]">
                    browse files
                  </span>
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Text paste area */}
      {inputType === "text" && (
        <div
          className={[
            "relative w-full min-h-[220px] md:flex-1 md:min-h-0 rounded-xl border overflow-hidden",
            "transition-all duration-200",
            isBusy
              ? "border-slate-200 bg-white pointer-events-none flex flex-col items-center justify-center gap-5"
              : isSuccess
              ? "border-[#f0c87a] bg-[#fef8ee] flex flex-col items-center justify-center gap-5"
              : isError
              ? "border-red-200 bg-red-50/30 flex flex-col items-center justify-center gap-5"
              : "border-slate-200 bg-white flex flex-col",
          ].join(" ")}
        >
          {isBusy && StepsPanel}
          {isSuccess && SuccessPanel}
          {isError && ErrorPanel}

          {isIdle && (
            <>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); processText(); } }}
                placeholder="Paste your notes, lecture text, or study material here…"
                className={[
                  "flex-1 w-full px-5 pt-4 pb-2",
                  "text-sm text-slate-700 placeholder:text-slate-300",
                  "bg-transparent resize-none focus:outline-none overflow-y-auto",
                  "leading-relaxed",
                ].join(" ")}
              />
              <div className="flex items-center shrink-0 px-5 py-3">
                {rawText.length > 0 ? (
                  <span className={[
                    "text-xs select-none pointer-events-none tabular-nums",
                    rawText.length >= clientCharCap
                      ? "text-red-500"
                      : rawText.length > clientCharCap * 0.9
                      ? "text-amber-500"
                      : "text-slate-400",
                  ].join(" ")}>
                    {rawText.length >= clientCharCap
                      ? "Limit reached"
                      : `${(clientCharCap - rawText.length).toLocaleString()} left`}
                  </span>
                ) : (
                  <span className="hidden md:block text-xs text-slate-400 select-none pointer-events-none">
                    ⌘↵ to generate
                  </span>
                )}
                <motion.button
                  type="button"
                  onClick={processText}
                  disabled={!rawText.trim()}
                  className={[
                    "ml-auto px-5 py-2 rounded-full text-[11px] font-medium tracking-widest uppercase",
                    "bg-[#c97f1a] text-white transition-opacity duration-150",
                    rawText.trim() ? "opacity-100" : "opacity-25 cursor-not-allowed",
                  ].join(" ")}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                >
                  Generate
                </motion.button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
    <UpgradeModal
      isOpen={upgradeReason !== null}
      onClose={() => setUpgradeReason(null)}
      reason={upgradeReason ?? "limit"}
      identifier={identifier}
    />
    </>
  );
}
