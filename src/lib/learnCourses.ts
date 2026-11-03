import type { SupabaseClient } from "@supabase/supabase-js";

export type LearnCourse = {
  materialId: string;
  workspaceId: string;
  name: string;
  totalUnits: number; // 0 until the course has been opened once
  totalModules: number;
  currentUnit: number; // 0 = not started
  currentModule: number;
  unitInModule: number;
  unitsInModule: number;
  percent: number; // 0-100, units finished
  lastStudied: string | null;
};

// Learn courses = materials that live in a workspace with kind = 'learn'.
export async function loadLearnCourses(
  supabase: SupabaseClient
): Promise<LearnCourse[]> {
  const { data: mats } = await supabase
    .from("materials")
    .select(
      "id, workspace_id, file_name, uploaded_at, workspaces!inner(kind), material_units(unit_number, module_number, unit_in_module)"
    )
    .eq("workspaces.kind", "learn")
    .order("uploaded_at", { ascending: false });

  const { data: progress } = await supabase
    .from("learn_progress")
    .select("material_id, current_unit, updated_at");

  const progressByMaterial = new Map(
    (progress ?? []).map((p) => [p.material_id as string, p])
  );

  type UnitRow = {
    unit_number: number;
    module_number: number | null;
    unit_in_module: number | null;
  };
  type Row = {
    id: string;
    workspace_id: string;
    file_name: string;
    material_units?: UnitRow[];
  };

  const courses = ((mats ?? []) as unknown as Row[]).map((m) => {
    const p = progressByMaterial.get(m.id);
    const units = m.material_units ?? [];
    const currentUnit: number = p?.current_unit ?? 0;
    const cur = units.find((u) => u.unit_number === currentUnit);
    // parts of one long unit count as one unit
    const inModule = cur
      ? new Set(
          units.filter((u) => u.module_number === cur.module_number).map((u) => u.unit_in_module)
        ).size
      : 0;
    const modules = new Set(units.map((u) => u.module_number));
    return {
      materialId: m.id,
      workspaceId: m.workspace_id,
      name: m.file_name.replace(/\.(pdf|docx)$/i, ""),
      totalUnits: units.length,
      totalModules: modules.size,
      currentUnit,
      currentModule: cur?.module_number ?? 0,
      unitInModule: cur?.unit_in_module ?? 0,
      unitsInModule: inModule,
      percent:
        units.length > 0 && currentUnit > 0
          ? Math.round(((currentUnit - 1) / units.length) * 100)
          : 0,
      lastStudied: (p?.updated_at as string | undefined) ?? null,
    } satisfies LearnCourse;
  });

  // most recently studied first
  return courses.sort((a, b) =>
    (b.lastStudied ?? "").localeCompare(a.lastStudied ?? "")
  );
}

export function learnHref(c: LearnCourse) {
  return `/workspace/${c.workspaceId}/learn?material=${c.materialId}`;
}

// "Module 2 · Unit 3 of 4" (or "Not started")
export function whereYouStopped(c: LearnCourse) {
  if (c.currentUnit === 0 || c.totalUnits === 0) return "Not started";
  return `Module ${c.currentModule} · Unit ${c.unitInModule} of ${c.unitsInModule}`;
}
