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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { questionSetId } = await req.json();
    if (!questionSetId) {
      return jsonResponse({ error: "questionSetId is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
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

    // material_chunks are scoped to materials, which are scoped to workspaces
    const { data: materials } = await supabase
      .from("materials")
      .select("id")
      .eq("workspace_id", questionSet.workspace_id);

    const materialIds = (materials ?? []).map((m) => m.id);

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

      const questionEmbedding = await embedText(geminiKey, question.ocr_text);

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

    return jsonResponse({ success: true, answered: questions.length });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
