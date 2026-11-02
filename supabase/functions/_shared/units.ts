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
