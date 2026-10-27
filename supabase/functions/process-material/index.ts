// Edge Function: process-material
// Downloads an uploaded material file, extracts its text, chunks it,
// embeds each chunk with Gemini, and stores the chunks + embeddings.
//
// Invoke: supabase.functions.invoke("process-material", { body: { materialId } })

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { chunkText } from "../_shared/chunk.ts";
import { embedTexts } from "../_shared/gemini.ts";
import { sha256Bytes, sha256Text } from "../_shared/hash.ts";

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

    // Memory hit: already indexed (or an identical file elsewhere is reused),
    // so there is nothing to download or embed.
    if (material.chunks_from || material.indexed_at) {
      return jsonResponse({
        success: true,
        done: true,
        processed: 0,
        total: 0,
        reused: true,
        rateLimited: false,
      });
    }
    if (!material.storage_path) {
      return jsonResponse({ error: "Original file is gone and material is not indexed" }, 409);
    }

    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("materials")
      .download(material.storage_path);

    if (downloadError || !fileBlob) {
      return jsonResponse({ error: "Could not download material file" }, 500);
    }

    const buffer = new Uint8Array(await fileBlob.arrayBuffer());

    // Server-side file fingerprint is the source of truth for dedupe.
    const fileHash = await sha256Bytes(buffer);
    if (material.content_hash !== fileHash) {
      await supabase
        .from("materials")
        .update({ content_hash: fileHash })
        .eq("id", materialId);
    }
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

    // Chunk-level memory: hash every chunk, compare with what's already stored
    // for this material, and embed ONLY chunks we haven't seen. Chunks that
    // disappeared from the file are removed once the new ones are in, so an
    // updated file refreshes memory instead of rebuilding it.
    const allChunks = chunkText(rawText);
    const hashed = await Promise.all(
      allChunks.map(async (content, i) => ({
        content,
        hash: await sha256Text(content),
        position: i + 1,
      }))
    );
    const seen = new Set<string>();
    const wanted = hashed.filter((c) => (seen.has(c.hash) ? false : seen.add(c.hash)));

    const existing: { id: string; content_hash: string | null }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("material_chunks")
        .select("id, content_hash")
        .eq("material_id", materialId)
        .range(from, from + 999);
      if (error) throw new Error(`Chunk lookup failed: ${error.message}`);
      existing.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const existingHashes = new Set(existing.map((e) => e.content_hash));
    const todo = wanted.filter((c) => !existingHashes.has(c.hash));
    const reused = wanted.length - todo.length;

    // Resumable + rate-limit aware. Gemini's free tier allows ~30k embedding
    // tokens/minute, so a big PDF can't be indexed in one burst. We embed in
    // small batches, pace to stay under the limit, stop before the Edge
    // Function wall-clock limit, and report progress. The client simply calls
    // this again until done=true; already-stored chunks are skipped.
    let cursor = 0;
    const startedAt = Date.now();
    let windowStart = Date.now();
    let windowTokens = 0;
    let rateLimited = false;

    while (cursor < todo.length) {
      const batch = todo.slice(cursor, cursor + BATCH_SIZE);
      const estTokens = Math.ceil(batch.map((c) => c.content).join("").length / 3);

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
        embeddings = await embedTexts(
          geminiKey,
          batch.map((c) => c.content),
          "RETRIEVAL_DOCUMENT"
        );
      } catch (e) {
        if (String(e).includes(" 429 ")) {
          rateLimited = true;
          break;
        }
        throw e;
      }

      const { error: insertError } = await supabase.from("material_chunks").insert(
        batch.map((c, i) => ({
          material_id: materialId,
          content: c.content,
          content_hash: c.hash,
          embedding: embeddings[i],
          page_ref: `chunk ${c.position}`,
        }))
      );
      if (insertError) {
        throw new Error(`Chunk insert failed: ${insertError.message}`);
      }

      windowTokens += estTokens;
      cursor += batch.length;
    }

    const done = cursor >= todo.length;
    let removed = 0;

    if (done) {
      // New content is fully in; now drop chunks that are no longer in the file.
      const keep = new Set(wanted.map((c) => c.hash));
      const staleIds = existing
        .filter((e) => !e.content_hash || !keep.has(e.content_hash))
        .map((e) => e.id);
      for (let i = 0; i < staleIds.length; i += 100) {
        await supabase.from("material_chunks").delete().in("id", staleIds.slice(i, i + 100));
      }
      removed = staleIds.length;

      await supabase
        .from("materials")
        .update({ indexed_at: new Date().toISOString() })
        .eq("id", materialId);
    }

    return jsonResponse({
      success: true,
      done,
      processed: reused + cursor,
      total: wanted.length,
      reused,
      embedded: cursor,
      removed,
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
