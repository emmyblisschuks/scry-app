// Splits a material's raw extracted text into teachable units.
// Prefers the course's own "UNIT n" / "MODULE n" headings (standard in NOUN
// course material); falls back to even word-count slices for material that
// isn't structured that way.

export type RawUnit = { title: string; content: string };

const HEADING_RE = /^[ \t]*(UNIT|MODULE)[ \t]+([A-Z0-9]+)\b[:\-]?[ \t]*(.*)$/gim;

export function splitIntoUnits(text: string): RawUnit[] {
  const clean = text.replace(/\r\n/g, "\n");
  const matches = [...clean.matchAll(HEADING_RE)];

  // Prefer UNIT-level headings (finer grain); fall back to whatever's there.
  const unitMatches = matches.filter((m) => m[1].toUpperCase() === "UNIT");
  const chosen = unitMatches.length >= 2 ? unitMatches : matches;

  if (chosen.length >= 2) {
    const units: RawUnit[] = [];
    for (let i = 0; i < chosen.length; i++) {
      const start = chosen[i].index!;
      const end = i + 1 < chosen.length ? chosen[i + 1].index! : clean.length;
      const segment = clean.slice(start, end).trim();
      const title = chosen[i][0].replace(/\s+/g, " ").trim().slice(0, 120);
      if (segment.length > 200) units.push({ title, content: segment });
    }
    if (units.length >= 2) return units;
  }

  return fallbackSplit(clean);
}

function fallbackSplit(text: string, wordsPerUnit = 2200): RawUnit[] {
  const words = text.split(/\s+/).filter(Boolean);
  const units: RawUnit[] = [];
  let n = 1;
  for (let i = 0; i < words.length; i += wordsPerUnit, n++) {
    const content = words.slice(i, i + wordsPerUnit).join(" ");
    if (content.trim()) units.push({ title: `Part ${n}`, content });
  }
  return units.length > 0 ? units : [{ title: "Full material", content: text }];
}
