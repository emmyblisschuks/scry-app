// Edge Function: teach-unit
// Learn Mode. Breaks a study material into units (reusing the course's own
// UNIT/MODULE headings where possible), then teaches one unit at a time in
// simple language with real-world examples. Units and lessons are cached
// per material in `material_units`, so once a unit is taught the first
// time, every later visit (any student) is instant and free.
//
// Invoke: supabase.functions.invoke("teach-unit", { body: { materialId, unitNumber? } })
// unitNumber omitted -> resumes wherever this student last left off (or unit 1).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  generateQuiz,
  gradeTheory,
  teachUnit,
  type ObjectiveQuestion,
  type TheoryQuestion,
} from "../_shared/gemini.ts";
import { splitIntoParts, splitIntoUnits } from "../_shared/units.ts";
import type { LearnMode } from "../_shared/lesson-prompt.ts";

// @ts-expect-error - npm specifier, resolved at deploy time by Supabase
import pdfParse from "npm:pdf-parse@1.1.1";
// @ts-expect-error - npm specifier, resolved at deploy time by Supabase
import mammoth from "npm:mammoth@1.8.0";

// Extracted text is stored whole (up to this safety cap). Long units are split
// into parts when they are first segmented, so no text is dropped.
const MAX_EXTRACTED_CHARS = 1_500_000;
const SPLIT_VERSION = 4;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Not authenticated" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData.user) return jsonResponse({ error: "Not authenticated" }, 401);
    const userId = userData.user.id;

    const { materialId, unitNumber, action, answers } = await req.json();
    if (!materialId) return jsonResponse({ error: "materialId is required" }, 400);

    const { data: material, error: materialError } = await supabase
      .from("materials")
      .select("id, workspace_id, file_name, extracted_text, storage_path, chunks_from, learn_mode")
      .eq("id", materialId)
      .single();
    if (materialError || !material) return jsonResponse({ error: "Material not found" }, 404);

    const { data: workspace } = await supabase
      .from("workspaces")
      .select("id, user_id")
      .eq("id", material.workspace_id)
      .single();
    if (!workspace || workspace.user_id !== userId) {
      return jsonResponse({ error: "Not authorized" }, 403);
    }

    let extractedText = material.extracted_text as string | null;

    // Material indexed before Learn Mode existed (or linked to another
    // workspace's copy) won't have extracted_text yet. Backfill it here,
    // on demand, with a local parse — no Gemini call needed.
    if (!extractedText) {
      let storagePath = material.storage_path as string | null;
      let sourceMaterialId = materialId;

      if (!storagePath && material.chunks_from) {
        const { data: source } = await supabase
          .from("materials")
          .select("id, storage_path, extracted_text")
          .eq("id", material.chunks_from)
          .single();
        if (source?.extracted_text) extractedText = source.extracted_text;
        else if (source?.storage_path) {
          storagePath = source.storage_path;
          sourceMaterialId = source.id;
        }
      }

      if (!extractedText && storagePath) {
        const { data: fileBlob } = await supabase.storage
          .from("materials")
          .download(storagePath);
        if (fileBlob) {
          const buffer = new Uint8Array(await fileBlob.arrayBuffer());
          const isPdf = material.file_name.toLowerCase().endsWith(".pdf");
          try {
            const text = isPdf
              ? (await pdfParse(buffer)).text
              : (await mammoth.extractRawText({ buffer })).value;
            if (text.trim()) {
              extractedText = text.slice(0, MAX_EXTRACTED_CHARS);
              await supabase
                .from("materials")
                .update({ extracted_text: extractedText })
                .eq("id", sourceMaterialId);
              if (sourceMaterialId !== materialId) {
                await supabase
                  .from("materials")
                  .update({ extracted_text: extractedText })
                  .eq("id", materialId);
              }
            }
          } catch (e) {
            console.error("Learn Mode backfill parse failed:", e);
          }
        }
      }
    }

    if (!extractedText) {
      return jsonResponse(
        {
          error:
            "Couldn't read this material for Learn Mode (the original file may have been removed to save storage). Re-upload it and try again.",
        },
        409
      );
    }

    // Segment into modules, units and (for long units) parts once, then reuse
    // forever. Anything saved by an older version of the splitter is
    // re-segmented once; its cached lessons are dropped so they are
    // regenerated without the old cut-offs.
    type UnitMeta = {
      unit_number: number;
      title: string;
      module_number: number | null;
      module_title: string | null;
      unit_in_module: number | null;
      part_number: number;
      total_parts: number;
      split_version: number;
    };
    const unitCols =
      "unit_number, title, module_number, module_title, unit_in_module, part_number, total_parts, split_version";
    let { data: units } = await supabase
      .from("material_units")
      .select(unitCols)
      .eq("material_id", materialId)
      .order("unit_number", { ascending: true });

    if (units && units.length > 0 && (units[0].split_version ?? 1) < SPLIT_VERSION) {
      await supabase.from("material_units").delete().eq("material_id", materialId);
      units = [];
    }

    if (!units || units.length === 0) {
      const rows: Record<string, unknown>[] = [];
      for (const u of splitIntoUnits(extractedText)) {
        const parts = splitIntoParts(u.content);
        parts.forEach((partText, pi) => {
          rows.push({
            material_id: materialId,
            workspace_id: material.workspace_id,
            unit_number: rows.length + 1,
            title: u.title,
            source_text: partText,
            module_number: u.moduleNumber,
            module_title: u.moduleTitle,
            unit_in_module: u.unitInModule,
            part_number: pi + 1,
            total_parts: parts.length,
            split_version: SPLIT_VERSION,
          });
        });
      }
      const { error: insertError } = await supabase.from("material_units").insert(rows);
      if (insertError) throw new Error(`Could not save units: ${insertError.message}`);
      units = rows.map((r) => ({
        unit_number: r.unit_number as number,
        title: r.title as string,
        module_number: r.module_number as number,
        module_title: r.module_title as string,
        unit_in_module: r.unit_in_module as number,
        part_number: r.part_number as number,
        total_parts: r.total_parts as number,
        split_version: SPLIT_VERSION,
      }));
    }
    const allUnits = units as UnitMeta[];

    const totalUnits = units.length;

    const mode: LearnMode = material.learn_mode === "objective" ? "objective" : "theory";

    // ---- Quiz actions (optional, after a unit) ---------------------------
    if (action === "quiz-get" || action === "quiz-submit") {
      return await handleQuiz({
        supabase,
        userId,
        materialId,
        mode,
        unitNumber: Number(unitNumber),
        action,
        answers,
        allUnits,
      });
    }

    let targetUnit: number = unitNumber ?? 0;
    if (!targetUnit) {
      const { data: progress } = await supabase
        .from("learn_progress")
        .select("current_unit")
        .eq("user_id", userId)
        .eq("material_id", materialId)
        .maybeSingle();
      targetUnit = progress?.current_unit ?? 1;
    }
    targetUnit = Math.min(Math.max(1, targetUnit), totalUnits);

    const { data: unitRow, error: unitError } = await supabase
      .from("material_units")
      .select("*")
      .eq("material_id", materialId)
      .eq("unit_number", targetUnit)
      .single();
    if (unitError || !unitRow) return jsonResponse({ error: "Unit not found" }, 404);

    let lesson = unitRow.lesson_content as string | null;
    if (!lesson) {
      const geminiKey = Deno.env.get("GEMINI_API_KEY")!;
      let contextBefore: string | undefined;
      if ((unitRow.part_number ?? 1) > 1) {
        const { data: prev } = await supabase
          .from("material_units")
          .select("source_text")
          .eq("material_id", materialId)
          .eq("unit_number", targetUnit - 1)
          .maybeSingle();
        if (prev?.source_text) contextBefore = String(prev.source_text).slice(-500);
      }
      lesson = await teachUnit(geminiKey, unitRow.title, unitRow.source_text, {
        mode,
        partNumber: unitRow.part_number ?? 1,
        totalParts: unitRow.total_parts ?? 1,
        contextBefore,
      });
      await supabase
        .from("material_units")
        .update({ lesson_content: lesson, lesson_generated_at: new Date().toISOString() })
        .eq("id", unitRow.id);
    }

    await supabase.from("learn_progress").upsert(
      {
        user_id: userId,
        material_id: materialId,
        workspace_id: material.workspace_id,
        current_unit: targetUnit,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,material_id" }
    );

    const current = allUnits.find((u) => u.unit_number === targetUnit)!;
    const next = allUnits.find((u) => u.unit_number === targetUnit + 1);
    const inModule = new Set(
      allUnits
        .filter((u) => u.module_number === current.module_number)
        .map((u) => u.unit_in_module)
    );
    const moduleNumbers = [...new Set(allUnits.map((u) => u.module_number))];
    const isLastInModule = !next || next.module_number !== current.module_number;

    return jsonResponse({
      unitNumber: targetUnit,
      title: unitRow.title,
      lesson,
      totalUnits,
      hasNext: targetUnit < totalUnits,
      hasPrev: targetUnit > 1,
      moduleNumber: current.module_number,
      moduleTitle: current.module_title,
      unitInModule: current.unit_in_module,
      unitsInModule: inModule.size,
      partNumber: current.part_number,
      totalParts: current.total_parts,
      isLastPartOfUnit: current.part_number === current.total_parts,
      mode,
      totalModules: moduleNumbers.length,
      isLastInModule,
      nextModuleTitle: isLastInModule && next ? next.module_title : null,
    });
  } catch (err) {
    console.error("teach-unit error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type UnitRowLite = {
  unit_number: number;
  module_number: number | null;
  unit_in_module: number | null;
};

async function handleQuiz(args: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  materialId: string;
  mode: LearnMode;
  unitNumber: number;
  action: "quiz-get" | "quiz-submit";
  answers: unknown;
  allUnits: UnitRowLite[];
}) {
  const { supabase, userId, materialId, mode, unitNumber, action, answers, allUnits } = args;

  const target = allUnits.find((u) => u.unit_number === unitNumber);
  if (!target) return jsonResponse({ error: "Unit not found" }, 404);

  // The quiz covers the whole unit (all its parts) and is keyed to its last part.
  const unitParts = allUnits
    .filter(
      (u) => u.module_number === target.module_number && u.unit_in_module === target.unit_in_module
    )
    .map((u) => u.unit_number);
  const firstPart = Math.min(...unitParts);
  const lastPart = Math.max(...unitParts);

  const { data: partRows } = await supabase
    .from("material_units")
    .select("id, unit_number, title, source_text")
    .eq("material_id", materialId)
    .gte("unit_number", firstPart)
    .lte("unit_number", lastPart)
    .order("unit_number", { ascending: true });
  if (!partRows || partRows.length === 0) return jsonResponse({ error: "Unit not found" }, 404);
  const lastRow = partRows[partRows.length - 1];

  const { data: cached } = await supabase
    .from("unit_quizzes")
    .select("questions, mode")
    .eq("material_unit_id", lastRow.id)
    .maybeSingle();

  let questions = cached?.questions as (ObjectiveQuestion | TheoryQuestion)[] | undefined;

  if (!questions) {
    const geminiKey = Deno.env.get("GEMINI_API_KEY")!;
    const text = partRows.map((r: { source_text: unknown }) => r.source_text as string).join("\n\n");
    questions = (await generateQuiz(geminiKey, mode, partRows[0].title as string, text)) as (
      | ObjectiveQuestion
      | TheoryQuestion
    )[];
    await supabase
      .from("unit_quizzes")
      .upsert({ material_unit_id: lastRow.id, mode, questions }, { onConflict: "material_unit_id" });
  }

  if (action === "quiz-get") {
    // answer keys stay on the server until the student submits
    const safe =
      mode === "objective"
        ? (questions as ObjectiveQuestion[]).map((q) => ({ question: q.question, options: q.options }))
        : (questions as TheoryQuestion[]).map((q) => ({ question: q.question }));
    return jsonResponse({ mode, title: partRows[0].title, questions: safe });
  }

  // ---- quiz-submit ----
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    return jsonResponse({ error: "Please send one answer per question." }, 400);
  }

  let score = 0;
  let total = 0;
  let results: unknown[];

  if (mode === "objective") {
    const qs = questions as ObjectiveQuestion[];
    results = qs.map((q, i) => {
      const chosen = Number.isInteger(answers[i]) ? (answers[i] as number) : null;
      const correct = chosen === q.answerIndex;
      if (correct) score += 1;
      return {
        question: q.question,
        options: q.options,
        chosen,
        correctIndex: q.answerIndex,
        correct,
        explanation: q.explanation,
      };
    });
    total = qs.length;
  } else {
    const qs = questions as TheoryQuestion[];
    const geminiKey = Deno.env.get("GEMINI_API_KEY")!;
    const texts = qs.map((_, i) => (typeof answers[i] === "string" ? (answers[i] as string).slice(0, 4000) : ""));
    const grades = await gradeTheory(
      geminiKey,
      qs.map((q, i) => ({ ...q, studentAnswer: texts[i] }))
    );
    results = qs.map((q, i) => {
      score += grades[i].score;
      return {
        question: q.question,
        answer: texts[i],
        score: grades[i].score,
        outOf: 10,
        feedback: grades[i].feedback,
        missed: grades[i].missed,
        modelAnswer: q.modelAnswer,
        points: q.points,
      };
    });
    total = qs.length * 10;
  }

  // history is best-effort; never fail the response over it
  const { error: saveError } = await supabase.from("quiz_attempts").insert({
    user_id: userId,
    material_unit_id: lastRow.id,
    answers,
    score,
    total,
    result: results,
  });
  if (saveError) console.error("quiz attempt not saved:", saveError.message);

  return jsonResponse({ mode, score, total, results });
}
