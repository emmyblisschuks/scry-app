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

    // Embed in batches (<=100 per request), then insert in a single call
    const embeddings = await embedTexts(geminiKey, chunks, "RETRIEVAL_DOCUMENT");
    const rows = chunks.map((content, i) => ({
      material_id: materialId,
      content,
      embedding: embeddings[i],
      page_ref: `chunk ${i + 1}`,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error: insertError } = await supabase
        .from("material_chunks")
        .insert(rows.slice(i, i + 200));
      if (insertError) throw new Error(`Chunk insert failed: ${insertError.message}`);
    }

    return jsonResponse({ success: true, chunkCount: chunks.length });
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
