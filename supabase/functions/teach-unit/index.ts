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
import { teachUnit } from "../_shared/gemini.ts";
import { splitIntoUnits } from "../_shared/units.ts";

// @ts-expect-error - npm specifier, resolved at deploy time by Supabase
import pdfParse from "npm:pdf-parse@1.1.1";
// @ts-expect-error - npm specifier, resolved at deploy time by Supabase
import mammoth from "npm:mammoth@1.8.0";

// Keeps each lesson call comfortably inside the free-tier token budget.
const MAX_UNIT_CHARS = 16_000;

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

    const { materialId, unitNumber } = await req.json();
    if (!materialId) return jsonResponse({ error: "materialId is required" }, 400);

    const { data: material, error: materialError } = await supabase
      .from("materials")
      .select("id, workspace_id, file_name, extracted_text, storage_path, chunks_from")
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
              extractedText = text.slice(0, 500_000);
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

    // Segment into units once, then reuse forever.
    let { data: units } = await supabase
      .from("material_units")
      .select("unit_number, title")
      .eq("material_id", materialId)
      .order("unit_number", { ascending: true });

    if (!units || units.length === 0) {
      const raw = splitIntoUnits(extractedText);
      const rows = raw.map((u, i) => ({
        material_id: materialId,
        workspace_id: material.workspace_id,
        unit_number: i + 1,
        title: u.title,
        source_text: u.content.slice(0, MAX_UNIT_CHARS),
      }));
      const { error: insertError } = await supabase.from("material_units").insert(rows);
      if (insertError) throw new Error(`Could not save units: ${insertError.message}`);
      units = rows.map((r) => ({ unit_number: r.unit_number, title: r.title }));
    }

    const totalUnits = units.length;

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
      lesson = await teachUnit(geminiKey, unitRow.title, unitRow.source_text);
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

    return jsonResponse({
      unitNumber: targetUnit,
      title: unitRow.title,
      lesson,
      totalUnits,
      hasNext: targetUnit < totalUnits,
      hasPrev: targetUnit > 1,
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
