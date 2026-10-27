// Edge Function: generate-answers
// For every question in a question_set, embeds the OCR'd question text,
// retrieves the nearest material_chunks via pgvector, asks Gemini to answer
// using ONLY those chunks, and writes the result to the answers table.
// Marks the question_set as "done" when finished so the client can stop polling.
//
// Invoke: supabase.functions.invoke("generate-answers", { body: { questionSetId } })

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { embedText, generateAnswer } from "../_shared/gemini.ts";

const MATCH_COUNT = 4; // top-k chunks to retrieve per question

Deno.serve(async (req) => {
  let questionSetId: string | undefined;
  let supabaseForError: ReturnType<typeof createClient> | null = null;
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    ({ questionSetId } = await req.json());
    if (!questionSetId) {
      return jsonResponse({ error: "questionSetId is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    supabaseForError = supabase;
    const geminiKey = Deno.env.get("GEMINI_API_KEY")!;

    await supabase
      .from("question_sets")
      .update({ status: "processing" })
      .eq("id", questionSetId);

    const { data: questionSet } = await supabase
      .from("question_sets")
      .select("workspace_id")
      .eq("id", questionSetId)
      .single();

    if (!questionSet) {
      return jsonResponse({ error: "Question set not found" }, 404);
    }

    // material_chunks are scoped to materials, which are scoped to workspaces.
    // A material can point at another material's chunks (identical file already
    // in memory); follow that link only when both belong to the same user.
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("user_id")
      .eq("id", questionSet.workspace_id)
      .single();

    const { data: materials } = await supabase
      .from("materials")
      .select("id, chunks_from")
      .eq("workspace_id", questionSet.workspace_id);

    const linkIds = (materials ?? [])
      .map((m: { chunks_from: string | null }) => m.chunks_from)
      .filter((v): v is string => !!v);
    const ownedLinks = new Set<string>();
    if (linkIds.length > 0 && workspace) {
      const { data: sources } = await supabase
        .from("materials")
        .select("id, workspaces!inner(user_id)")
        .in("id", linkIds)
        .eq("workspaces.user_id", workspace.user_id);
      (sources ?? []).forEach((r: { id: string }) => ownedLinks.add(r.id));
    }

    const materialIds = [
      ...new Set(
        (materials ?? []).map((m: { id: string; chunks_from: string | null }) =>
          m.chunks_from && ownedLinks.has(m.chunks_from) ? m.chunks_from : m.id
        )
      ),
    ];

    const { data: questions } = await supabase
      .from("questions")
      .select("*")
      .eq("question_set_id", questionSetId)
      .order("order_index");

    if (!questions || questions.length === 0) {
      await supabase
        .from("question_sets")
        .update({ status: "done" })
        .eq("id", questionSetId);
      return jsonResponse({ success: true, answered: 0 });
    }

    for (const question of questions) {
      if (!question.ocr_text?.trim()) {
        await supabase.from("answers").insert({
          question_id: question.id,
          answer_text: "UNSURE",
          confidence: "unsure",
          source_snippet: null,
        });
        continue;
      }

      const questionEmbedding = await embedText(geminiKey, question.ocr_text, "RETRIEVAL_QUERY");

      // pgvector cosine-distance search via RPC (see sql/match_chunks.sql)
      const { data: matches } = await supabase.rpc("match_material_chunks", {
        query_embedding: questionEmbedding,
        material_ids: materialIds,
        match_count: MATCH_COUNT,
      });

      const contextChunks = (matches ?? []).map(
        (m: { id: string; content: string; page_ref: string }) => ({
          content: m.content,
          source: m.page_ref,
        })
      );

      if (contextChunks.length === 0) {
        await supabase.from("answers").insert({
          question_id: question.id,
          answer_text: "UNSURE",
          confidence: "unsure",
          source_snippet: null,
        });
        continue;
      }

      const result = await generateAnswer(
        geminiKey,
        question.ocr_text,
        contextChunks
      );

      await supabase.from("answers").insert({
        question_id: question.id,
        answer_text: result.answer,
        confidence: result.confidence,
        source_chunk_id: matches?.[0]?.id ?? null,
        source_snippet: result.sourceSnippet,
      });
    }

    await supabase
      .from("question_sets")
      .update({ status: "done" })
      .eq("id", questionSetId);

    // Run complete: answers + indexed material memory are kept, but the raw
    // uploads are no longer needed, so remove them from storage. Never fatal.
    const cleanup = await cleanupUploads(
      supabase,
      questionSetId,
      questionSet.workspace_id
    ).catch((e) => {
      console.error("upload cleanup failed (non-fatal)", e);
      return null;
    });

    return jsonResponse({ success: true, answered: questions.length, cleanup });
  } catch (err) {
    console.error(err);
    // don't leave the client polling a set that will never finish
    if (questionSetId && supabaseForError) {
      await supabaseForError
        .from("question_sets")
        .update({ status: "error" })
        .eq("id", questionSetId);
    }
    return jsonResponse({ error: String(err) }, 500);
  }
});

// Deletes original uploads once a question set is finished:
//  - this set's question screenshots
//  - the workspace's material files that are fully indexed (chunks live on in
//    material_chunks, so the memory is kept)
// Rows stay (answers, ocr_text, chunks); we only stamp *_deleted_at.
async function cleanupUploads(
  supabase: ReturnType<typeof createClient>,
  questionSetId: string,
  workspaceId: string
) {
  const stamp = new Date().toISOString();
  let images = 0;
  let files = 0;

  const { data: qs } = await supabase
    .from("questions")
    .select("id, image_path")
    .eq("question_set_id", questionSetId)
    .not("image_path", "is", null)
    .is("image_deleted_at", null);

  if (qs && qs.length > 0) {
    const { error } = await supabase.storage
      .from("question-screenshots")
      .remove(qs.map((q: { image_path: string }) => q.image_path));
    if (error) throw error;
    await supabase
      .from("questions")
      .update({ image_deleted_at: stamp })
      .in("id", qs.map((q: { id: string }) => q.id));
    images = qs.length;
  }

  const { data: mats } = await supabase
    .from("materials")
    .select("id, storage_path")
    .eq("workspace_id", workspaceId)
    .not("storage_path", "is", null)
    .not("indexed_at", "is", null)
    .is("file_deleted_at", null);

  if (mats && mats.length > 0) {
    const { error } = await supabase.storage
      .from("materials")
      .remove(mats.map((m: { storage_path: string }) => m.storage_path));
    if (error) throw error;
    await supabase
      .from("materials")
      .update({ file_deleted_at: stamp, storage_path: null })
      .in("id", mats.map((m: { id: string }) => m.id));
    files = mats.length;
  }

  return { images, files };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
