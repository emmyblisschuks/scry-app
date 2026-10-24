/**
 * Splits text into overlapping chunks suitable for embedding + retrieval.
 * Overlap keeps answers from getting cut off at a chunk boundary.
 */
export function chunkText(
  text: string,
  chunkSize = 1200,
  overlap = 200
): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= chunkSize) return [clean];

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length);
    chunks.push(clean.slice(start, end));
    if (end === clean.length) break;
    start = end - overlap;
  }

  return chunks;
}
