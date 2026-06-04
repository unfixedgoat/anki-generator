export function chunkText(text: string, targetSize = 25000): string[] {
  if (text.length <= targetSize) return [text];

  const hardLimit = Math.floor(targetSize * 1.15);
  const chunks: string[] = [];

  // Split into paragraphs, preserving delimiters
  const paragraphs = text.split(/(\n\n)/);
  // Rejoin so each "paragraph" includes its trailing \n\n
  const paras: string[] = [];
  for (let i = 0; i < paragraphs.length; i += 2) {
    paras.push(paragraphs[i] + (paragraphs[i + 1] ?? ""));
  }

  let current = "";

  for (const para of paras) {
    if (para === "") continue;

    // Paragraph fits alongside what we have
    if (current.length + para.length <= hardLimit) {
      current += para;
      // Flush if we've hit or passed target
      if (current.length >= targetSize) {
        chunks.push(current);
        current = "";
      }
      continue;
    }

    // Paragraph alone is small enough — flush current first, then start fresh
    if (para.length <= hardLimit) {
      if (current !== "") {
        chunks.push(current);
        current = "";
      }
      current = para;
      if (current.length >= targetSize) {
        chunks.push(current);
        current = "";
      }
      continue;
    }

    // Paragraph is oversized — split it at sentence boundaries
    if (current !== "") {
      chunks.push(current);
      current = "";
    }
    splitLargeBlock(para, targetSize, hardLimit, chunks);
  }

  if (current !== "") chunks.push(current);

  return chunks.filter((c) => c !== "");
}

function splitLargeBlock(
  block: string,
  targetSize: number,
  hardLimit: number,
  out: string[]
): void {
  // Split on sentence boundaries: ". ", "? ", "! ", preserving the delimiter
  const sentences = block.split(/(?<=[.?!])\s+/);
  let current = "";

  for (const sentence of sentences) {
    if (sentence === "") continue;

    const sep = current === "" ? "" : " ";

    if (current.length + sep.length + sentence.length <= hardLimit) {
      current += sep + sentence;
      if (current.length >= targetSize) {
        out.push(current);
        current = "";
      }
      continue;
    }

    // Sentence alone is small enough — flush and start fresh
    if (sentence.length <= hardLimit) {
      if (current !== "") {
        out.push(current);
        current = "";
      }
      current = sentence;
      if (current.length >= targetSize) {
        out.push(current);
        current = "";
      }
      continue;
    }

    // Single sentence exceeds hard limit — hard-split on whitespace
    if (current !== "") {
      out.push(current);
      current = "";
    }
    splitOnWhitespace(sentence, targetSize, hardLimit, out);
  }

  if (current !== "") out.push(current);
}

function splitOnWhitespace(
  text: string,
  targetSize: number,
  hardLimit: number,
  out: string[]
): void {
  const words = text.split(/\s+/);
  let current = "";

  for (const word of words) {
    if (word === "") continue;

    const sep = current === "" ? "" : " ";

    if (current.length + sep.length + word.length <= hardLimit) {
      current += sep + word;
    } else {
      if (current !== "") out.push(current);
      current = word;
    }
  }

  if (current !== "") out.push(current);
}
