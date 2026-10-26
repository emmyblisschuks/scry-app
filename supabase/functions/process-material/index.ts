// Edge Function: process-material
// Downloads an uploaded material file, extracts its text, chunks it,
// embeds each chunk with Gemini, and stores the chunks + embeddings.
//
// Invoke: supabase.functions.invoke("process-material", { body: { materialId } })

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { chunkText } from "../_shared/chunk.ts";
import { embedTexts } from "../_shared/gemini.ts";

// @ts-expect-error - npm specifier, resolved at deploy time by Supabase
import pdfParse from "npm:pdf-parse@1.1.1";
// @ts-expect-error - npm specifier, resolved at deploy time by Supabase
import mammoth from "npm:mammoth@1.8.0";

const BATCH_SIZE = 20; // ~6k tokens per request
const TOKENS_PER_MINUTE_BUDGET = 24_000; // free tier limit is 30k/min
const TIME_BUDGET_MS = 110_000; // Edge Functions are cut off at ~150s

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { materialId } = await req.json();
    if (!materialId) {
      return jsonResponse({ error: "materialId is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const geminiKey = Deno.env.get("GEMINI_API_KEY")!;

    const { data: material, error: materialError } = await supabase
      .from("materials")
      .select("*")
      .eq("id", materialId)
      .single();

    if (materialError || !material) {
      return jsonResponse({ error: "Material not found" }, 404);
    }

    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("materials")
      .download(material.storage_path);

    if (downloadError || !fileBlob) {
      return jsonResponse({ error: "Could not download material file" }, 500);
    }

    const buffer = new Uint8Array(await fileBlob.arrayBuffer());
    const isPdf = material.file_name.toLowerCase().endsWith(".pdf");

    let rawText = "";
    if (isPdf) {
      const parsed = await pdfParse(buffer);
      rawText = parsed.text;
    } else {
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value;
    }

    if (!rawText.trim()) {
      return jsonResponse({ error: "No extractable text found in material" }, 422);
    }

    const chunks = chunkText(rawText);

    // Resumable + rate-limit aware. Gemini's free tier allows ~30k embedding
    // tokens/minute, so a big PDF can't be indexed in one burst. We embed in
    // small batches, pace to stay under the limit, stop before the Edge
    // Function wall-clock limit, and report progress. The client simply calls
    // this again until done=true; chunks already stored are skipped.
    const { count: existing } = await supabase
      .from("material_chunks")
      .select("id", { count: "exact", head: true })
      .eq("material_id", materialId);

    let index = existing ?? 0;
    const startedAt = Date.now();
    let windowStart = Date.now();
    let windowTokens = 0;
    let rateLimited = false;

    while (index < chunks.length) {
      const batch = chunks.slice(index, index + BATCH_SIZE);
      const estTokens = Math.ceil(batch.join("").length / 3); // conservative

      if (windowTokens + estTokens > TOKENS_PER_MINUTE_BUDGET) {
        const waitMs = Math.max(0, 60_000 - (Date.now() - windowStart)) + 500;
        if (Date.now() - startedAt + waitMs > TIME_BUDGET_MS) break;
        await new Promise((r) => setTimeout(r, waitMs));
        windowStart = Date.now();
        windowTokens = 0;
      }
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;

      let embeddings: number[][];
      try {
        embeddings = await embedTexts(geminiKey, batch, "RETRIEVAL_DOCUMENT");
      } catch (e) {
        if (String(e).includes(" 429 ")) {
          rateLimited = true;
          break;
        }
        throw e;
      }

      const { error: insertError } = await supabase
        .from("material_chunks")
        .insert(
          batch.map((content, i) => ({
            material_id: materialId,
            content,
            embedding: embeddings[i],
            page_ref: `chunk ${index + i + 1}`,
          }))
        );
      if (insertError) {
        throw new Error(`Chunk insert failed: ${insertError.message}`);
      }

      windowTokens += estTokens;
      index += batch.length;
    }

    return jsonResponse({
      success: true,
      done: index >= chunks.length,
      processed: index,
      total: chunks.length,
      rateLimited,
    });
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
