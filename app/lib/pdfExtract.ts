"use client";

// pdfjs-dist v3 UMD build is loaded via <Script> in layout.tsx.
// It sets window.pdfjsLib automatically — no bundler involvement.

interface PdfjsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: { data: Uint8Array }): { promise: Promise<PdfDoc> };
}

interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}

interface PdfPage {
  getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
}

const WORKER_URL = "/pdf.worker.min.js";

function getPdfjs(): PdfjsLib {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lib = (window as any).pdfjsLib as PdfjsLib | undefined;
  if (!lib) throw new Error("PDF library not ready — please try again in a moment");
  return lib;
}

export async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjsLib = getPdfjs();
  pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str ?? "").join(" ");
    pages.push(text);
  }

  return pages.join("\n\n").trim();
}
