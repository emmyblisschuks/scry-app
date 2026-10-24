// Edge Function: process-material
// Downloads an uploaded material file, extracts its text, chunks it,
// embeds each chunk with Gemini, and stores the chunks + embeddings.
//
// Invoke: supabase.functions.invoke("process-material", { body: { materialId } })

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { chunkText } from "../_shared/chunk.ts";
import { embedText } from "../_shared/gemini.ts";

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

    // Embed + insert sequentially to stay well under Gemini rate limits;
    // swap for a small concurrency pool if this becomes a bottleneck.
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embedText(geminiKey, chunks[i]);
      await supabase.from("material_chunks").insert({
        material_id: materialId,
        content: chunks[i],
        embedding,
        page_ref: `chunk ${i + 1}`,
      });
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
