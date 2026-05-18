"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";
import DensityToggle, { type Density } from "./DensityToggle";
import StyleToggle, { type CardStyle } from "./StyleToggle";

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

async function submitToApi(
  formData: FormData,
  signal: AbortSignal
): Promise<{ blob: Blob; filename: string; cardCount: number }> {
  const res = await fetch("/api/generate", { method: "POST", body: formData, signal });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `Error ${res.status}` }));
    throw new Error(data.error ?? `Error ${res.status}`);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? "anki_deck.apkg";
  const cardCount = parseInt(res.headers.get("X-Card-Count") ?? "0", 10);
  return { blob: await res.blob(), filename, cardCount };
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

export default function DropZone({ onGenerated }: Props) {
  const [inputType, setInputType] = useState<InputType>("pdf");
  const [state, setState] = useState<DropState>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [density, setDensity] = useState<Density>("high-yield");
  const [cardStyle, setCardStyle] = useState<CardStyle>("standard");
  const [customPrompt, setCustomPrompt] = useState("");
  const [rawText, setRawText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTextRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const switchMode = useCallback((mode: InputType) => {
    setInputType(mode);
    setState("idle");
    setFileName(null);
    setErrorMsg(null);
  }, []);

  const cancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    abortRef.current?.abort();
  }, []);

  const handleApiResult = useCallback(
    async (formData: FormData, label: string, sourceText: string) => {
      setFileName(label);
      setErrorMsg(null);
      setState("loading");
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const { blob, filename, cardCount } = await submitToApi(formData, controller.signal);
        triggerDownload(blob, filename);
        setState("success");
        setFileName(filename);
        onGenerated?.({
          blob,
          filename,
          cardCount,
          density: formData.get("density") as Density,
          style: formData.get("style") as CardStyle,
          text: sourceText,
        });
      } catch (err) {
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
    [onGenerated]
  );

  const processFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setErrorMsg("Only PDF files are accepted.");
        setState("error");
        return;
      }

      setFileName(file.name);
      setErrorMsg(null);
      setState("extracting");

      let text: string;
      try {
        const { extractTextFromPdf } = await import("@/app/lib/pdfExtract");
        text = await extractTextFromPdf(file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[pdfExtract]", msg);
        setErrorMsg(`Could not extract text: ${msg}`);
        setState("error");
        return;
      }

      if (!text) {
        setErrorMsg("This PDF contains no extractable text (it may be scanned). Try pasting the text instead.");
        setState("error");
        return;
      }

      lastTextRef.current = text;
      const formData = new FormData();
      formData.append("text", text);
      formData.append("density", density);
      formData.append("style", cardStyle);
      formData.append("customPrompt", customPrompt);
      formData.append("filename", file.name);
      await handleApiResult(formData, file.name, text);
    },
    [density, cardStyle, customPrompt, handleApiResult]
  );

  const processText = useCallback(async () => {
    const text = rawText.trim();
    if (!text) return;
    lastTextRef.current = text;
    const formData = new FormData();
    formData.append("text", text);
    formData.append("density", density);
    formData.append("style", cardStyle);
    formData.append("customPrompt", customPrompt);
    await handleApiResult(formData, "pasted text", text);
  }, [rawText, density, cardStyle, customPrompt, handleApiResult]);

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
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const isHovering = state === "hovering";
  const isExtracting = state === "extracting";
  const isLoading = state === "loading";
  const isSuccess = state === "success";
  const isError = state === "error";
  const isIdle = state === "idle";
  const isBusy = isExtracting || isLoading;

  const ExtractingPanel = (
    <>
      <Loader2 className="w-8 h-8 text-[#c97f1a] animate-spin" strokeWidth={1.5} />
      <div className="text-center space-y-1.5">
        <p className="text-sm font-medium text-slate-600">Reading PDF…</p>
        <p className="text-xs text-slate-400 max-w-xs truncate px-4">{fileName}</p>
      </div>
    </>
  );

  const LoadingPanel = (
    <>
      <Loader2 className="w-8 h-8 text-[#c97f1a] animate-spin" strokeWidth={1.5} />
      <div className="text-center space-y-1.5">
        <p className="text-sm font-medium text-slate-600">Analyzing &amp; Generating Cards…</p>
        <p className="text-xs text-slate-400 max-w-xs truncate px-4">{fileName}</p>
      </div>
      <button
        onClick={cancel}
        className="absolute bottom-5 flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-600 transition-colors tracking-widest uppercase"
      >
        <X className="w-3 h-3" strokeWidth={2} />
        Cancel
      </button>
    </>
  );

  const SuccessPanel = (
    <>
      <div className="w-10 h-10 rounded-full bg-[#c97f1a] flex items-center justify-center">
        <CheckCircle2 className="w-5 h-5 text-white" strokeWidth={1.5} />
      </div>
      <div className="text-center space-y-1.5">
        <p className="text-sm font-medium text-[#7a4f0d]">Deck downloaded</p>
        <p className="text-xs text-slate-400 max-w-xs truncate px-4">{fileName}</p>
      </div>
      <button
        onClick={reset}
        className="absolute bottom-5 text-[11px] text-slate-400 hover:text-slate-600 transition-colors tracking-widest uppercase"
      >
        Start over
      </button>
    </>
  );

  const ErrorPanel = (
    <>
      <AlertCircle className="w-8 h-8 text-red-400" strokeWidth={1.5} />
      <div className="text-center space-y-1.5">
        <p className="text-sm font-medium text-slate-700 tracking-wide">Something went wrong</p>
        <p className="text-xs text-red-400 max-w-xs px-4 leading-relaxed">{errorMsg}</p>
      </div>
      <button
        onClick={reset}
        className="absolute bottom-5 text-[11px] text-slate-400 hover:text-slate-600 transition-colors tracking-widest uppercase"
      >
        Try again
      </button>
    </>
  );

  return (
    <div className="flex flex-col items-center gap-5 w-full h-full">

      {/* Mode toggle */}
      <div className="bg-[#f5f3ee] rounded-full p-[3px] flex w-full select-none">
        <button
          onClick={() => switchMode("pdf")}
          className={[
            "flex-1 text-center py-[7px] rounded-full text-[11px] transition-colors duration-150",
            inputType === "pdf"
              ? "bg-white text-[#7a4f0d] font-medium shadow-sm"
              : "text-slate-400",
          ].join(" ")}
        >
          Upload
        </button>
        <button
          onClick={() => switchMode("text")}
          className={[
            "flex-1 text-center py-[7px] rounded-full text-[11px] transition-colors duration-150",
            inputType === "text"
              ? "bg-white text-[#7a4f0d] font-medium shadow-sm"
              : "text-slate-400",
          ].join(" ")}
        >
          Paste
        </button>
      </div>

      <DensityToggle value={density} onChange={setDensity} disabled={isBusy} />
      <StyleToggle value={cardStyle} onChange={setCardStyle} disabled={isBusy} />

      {/* Custom prompt box */}
      {cardStyle === "custom" && (
        <textarea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="Describe exactly how you want Gemini to format your cards…"
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
          onKeyDown={(e) => e.key === "Enter" && openPicker()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={[
            "relative flex flex-col items-center justify-center gap-5",
            "w-full flex-1 min-h-0 rounded-xl border-2 border-dashed",
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

          {isExtracting && ExtractingPanel}
          {isLoading && LoadingPanel}
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
            "relative w-full flex-1 min-h-0 rounded-xl border overflow-hidden",
            "transition-all duration-200",
            isBusy
              ? "border-slate-200 bg-white pointer-events-none flex flex-col items-center justify-center gap-5"
              : isSuccess
              ? "border-[#f0c87a] bg-[#fef8ee] flex flex-col items-center justify-center gap-5"
              : isError
              ? "border-red-200 bg-red-50/30 flex flex-col items-center justify-center gap-5"
              : "border-slate-200 bg-white",
          ].join(" ")}
        >
          {isLoading && LoadingPanel}
          {isSuccess && SuccessPanel}
          {isError && ErrorPanel}

          {isIdle && (
            <>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Paste your notes, lecture text, or study material here…"
                className={[
                  "absolute inset-0 w-full h-full px-5 py-4 pb-14",
                  "text-sm text-slate-700 placeholder:text-slate-300",
                  "bg-transparent resize-none focus:outline-none",
                  "leading-relaxed",
                ].join(" ")}
              />
              <button
                onClick={processText}
                disabled={!rawText.trim()}
                className={[
                  "absolute bottom-4 right-4 z-10",
                  "px-5 py-2 rounded-full text-[11px] font-medium tracking-widest uppercase",
                  "bg-[#c97f1a] text-white transition-opacity duration-150",
                  rawText.trim() ? "opacity-100" : "opacity-25 cursor-not-allowed",
                ].join(" ")}
              >
                Generate
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
