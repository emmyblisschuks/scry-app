import type { SupabaseClient } from "@supabase/supabase-js";

export type OutlineUnit = {
  unitNumber: number; // the first part's number: where tapping this unit jumps to
  unitInModule: number;
  title: string;
};

export type OutlineModule = {
  moduleNumber: number;
  title: string;
  units: OutlineUnit[];
};

// "UNIT 2: THE LEGENDRE POLYNOMIALS" -> "The Legendre Polynomials"
export function cleanHeading(raw: string, kind: "UNIT" | "MODULE"): string {
  const stripped = raw
    .replace(new RegExp(`^\\s*${kind}\\s+[A-Z0-9]+\\b\\s*[:\\-–—.]?\\s*`, "i"), "")
    .trim();
  const base = stripped || raw.trim();
  // Headings in course PDFs are usually ALL CAPS; make them read like a book.
  if (base === base.toUpperCase() && /[A-Z]/.test(base)) {
    return base
      .toLowerCase()
      .replace(/(^|[\s(\-/])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
      .replace(/\b(Of|And|The|In|On|To|For|A|An|Or|With|By)\b(?!$)/g, (w, _w, offset: number) =>
        offset === 0 ? w : w.toLowerCase()
      );
  }
  return base;
}

type Row = {
  unit_number: number;
  title: string;
  module_number: number | null;
  module_title: string | null;
  unit_in_module: number | null;
  part_number: number | null;
};

export async function loadOutline(
  supabase: SupabaseClient,
  materialId: string
): Promise<OutlineModule[]> {
  const { data, error } = await supabase
    .from("material_units")
    .select("unit_number, title, module_number, module_title, unit_in_module, part_number")
    .eq("material_id", materialId)
    .order("unit_number", { ascending: true });
  if (error) throw new Error(error.message);

  const modules = new Map<number, OutlineModule>();
  for (const r of (data ?? []) as Row[]) {
    const mNum = r.module_number ?? 1;
    let mod = modules.get(mNum);
    if (!mod) {
      mod = {
        moduleNumber: mNum,
        title: r.module_title ? cleanHeading(r.module_title, "MODULE") : "",
        units: [],
      };
      modules.set(mNum, mod);
    }
    // Long units are stored as several parts: list the unit once.
    if (mod.units.some((u) => u.unitInModule === (r.unit_in_module ?? 0))) continue;
    mod.units.push({
      unitNumber: r.unit_number,
      unitInModule: r.unit_in_module ?? mod.units.length + 1,
      title: cleanHeading(r.title, "UNIT"),
    });
  }
  return [...modules.values()].sort((a, b) => a.moduleNumber - b.moduleNumber);
}
