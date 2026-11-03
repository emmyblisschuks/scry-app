// Splits a material's raw extracted text into Module -> Unit lessons.
// Uses the course's own "MODULE n" / "UNIT n" headings (standard in NOUN
// course material). Units are numbered sequentially across the whole course
// (unit_number) and also carry their module (module_number) and position
// inside that module (unit_in_module). Falls back to even word-count slices
// for material that isn't structured that way.

export type RawUnit = {
  title: string;
  content: string;
  moduleNumber: number;
  moduleTitle: string;
  unitInModule: number;
};

const HEADING_RE = /^[ \t]*(UNIT|MODULE)[ \t]+([A-Z0-9]+)\b[:\-]?[ \t]*(.*)$/gim;

type Heading = { kind: "UNIT" | "MODULE"; label: string; title: string; index: number };

export function splitIntoUnits(text: string): RawUnit[] {
  const clean = text.replace(/\r\n/g, "\n");
  const headings: Heading[] = [...clean.matchAll(HEADING_RE)].map((m) => ({
    kind: m[1].toUpperCase() as "UNIT" | "MODULE",
    label: m[2],
    title: m[0].replace(/\s+/g, " ").trim().slice(0, 120),
    index: m.index!,
  }));

  const hasUnits = headings.filter((h) => h.kind === "UNIT").length >= 2;
  const hasModules = headings.some((h) => h.kind === "MODULE");

  if (hasUnits || headings.length >= 2) {
    // Every heading ends the previous segment. A UNIT heading starts a unit;
    // a MODULE heading starts a new module (and a unit of its own only when
    // the material has no UNIT headings at all).
    const unitKind = hasUnits ? "UNIT" : "MODULE";
    const units: RawUnit[] = [];
    let moduleNumber = 0;
    let moduleTitle = "Course";
    let unitInModule = 0;
    let lastModuleLabel: string | null = null;

    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const end = i + 1 < headings.length ? headings[i + 1].index : clean.length;

      if (h.kind === "MODULE" && hasModules) {
        if (h.label !== lastModuleLabel) {
          moduleNumber += 1;
          unitInModule = 0;
          lastModuleLabel = h.label;
        }
        moduleTitle = h.title;
      }

      if (h.kind !== unitKind) continue;
      const segment = clean.slice(h.index, end).trim();
      if (segment.length <= 200) continue; // table-of-contents lines etc.

      if (moduleNumber === 0) moduleNumber = 1;
      unitInModule += 1;
      units.push({
        title: h.title,
        content: segment,
        moduleNumber,
        moduleTitle,
        unitInModule,
      });
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
    if (content.trim()) {
      units.push({
        title: `Part ${n}`,
        content,
        moduleNumber: 1,
        moduleTitle: "Course",
        unitInModule: n,
      });
    }
  }
  return units.length > 0
    ? units
    : [{ title: "Full material", content: text, moduleNumber: 1, moduleTitle: "Course", unitInModule: 1 }];
}

// ---------------------------------------------------------------------------
// Long units are taught in parts instead of being cut off. Parts are packed
// from whole paragraphs (then lines, then sentences, then a hard slice as a
// last resort) so no part starts or ends mid-thought, and nothing is dropped.
// ---------------------------------------------------------------------------

export const PART_CHARS = 14_000; // ~3.5k tokens: inside the 1k-4k summarisation sweet spot

export function splitIntoParts(text: string, max = PART_CHARS): string[] {
  const clean = text.trim();
  if (clean.length <= max) return [clean];

  // 1. break into atoms that each fit in `max`
  const atoms: string[] = [];
  for (const para of clean.split(/\n{2,}/)) {
    pushFitting(para, max, atoms);
  }

  // 2. greedily pack atoms into parts
  const parts: string[] = [];
  let cur = "";
  for (const atom of atoms) {
    const next = cur ? `${cur}\n\n${atom}` : atom;
    if (next.length > max && cur) {
      parts.push(cur);
      cur = atom;
    } else {
      cur = next;
    }
  }
  if (cur) parts.push(cur);

  // 3. don't leave a tiny orphan part at the end
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];
    if (last.length < max * 0.25 && prev.length + last.length + 2 <= max * 1.25) {
      parts.splice(parts.length - 2, 2, `${prev}\n\n${last}`);
    }
  }

  // 4. safety check: every non-space character must still be present
  const strip = (t: string) => t.replace(/\s+/g, "");
  if (strip(parts.join("")) !== strip(clean)) {
    throw new Error("Splitting a long unit lost text; refusing to continue.");
  }
  return parts;
}

function pushFitting(piece: string, max: number, out: string[]) {
  if (piece.length <= max) {
    if (piece.trim()) out.push(piece.trim());
    return;
  }
  // try lines, then sentences, then a hard slice
  const lines = piece.split(/\n/);
  if (lines.length > 1) {
    packInto(lines, "\n", max, out);
    return;
  }
  const sentences = piece.split(/(?<=[.!?])\s+/);
  if (sentences.length > 1) {
    packInto(sentences, " ", max, out);
    return;
  }
  for (let i = 0; i < piece.length; i += max) out.push(piece.slice(i, i + max));
}

function packInto(units: string[], sep: string, max: number, out: string[]) {
  let cur = "";
  for (const u of units) {
    if (u.length > max) {
      if (cur) out.push(cur);
      cur = "";
      pushFitting(u, max, out);
      continue;
    }
    const next = cur ? `${cur}${sep}${u}` : u;
    if (next.length > max && cur) {
      out.push(cur);
      cur = u;
    } else {
      cur = next;
    }
  }
  if (cur.trim()) out.push(cur);
}
