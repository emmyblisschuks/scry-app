// Splits a pasted block into separate questions when it's clearly numbered
// ("1.", "2)", "Q3:", "Question 4 -"). Otherwise the whole paste is one
// question, so multiple-choice options on their own lines stay attached.
const MARKER = /^[ \t]*(?:q(?:uestion)?[ \t]*)?\d{1,3}[ \t]*[.):\-][ \t]+/gim;

export function parseQuestions(raw: string): string[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const starts: number[] = [];
  for (const m of text.matchAll(MARKER)) starts.push(m.index!);

  if (starts.length < 2) return [text];

  const parts: string[] = [];
  // anything before the first marker is kept with the first question
  if (starts[0] > 0) starts[0] = 0;
  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : text.length;
    const chunk = text.slice(start, end).trim();
    if (chunk) parts.push(chunk);
  });
  return parts;
}
