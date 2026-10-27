// Deno-native Gemini REST client, used by Edge Functions only.
// Mirrors src/lib/gemini/client.ts but kept separate since Edge Functions
// don't share a bundler with the Next.js app.

// text-embedding-004 was shut down by Google on 2026-01-14 (404 NOT_FOUND).
// gemini-embedding-001 outputs 3072 dims by default; we request 768 via
// outputDimensionality so it still fits material_chunks.embedding vector(768).
const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIMS = 768;
// Answering model: Gemini 3.5 Flash is free to call. Override without a
// redeploy via `supabase secrets set GEMINI_MODEL=<model id>`.
const GENERATE_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

type EmbedTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

// POST to Gemini, retrying 429/503 a couple of times and honouring the
// "retry in Ns" hint so free-tier per-minute limits don't fail the whole run.
async function geminiPost(
  url: string,
  body: unknown,
  label: string,
  maxRetries = 2
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res;

    const text = await res.text();
    if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
      const hint =
        text.match(/retry in ([\d.]+)s/i) ??
        text.match(/"retryDelay":\s*"(\d+)s"/);
      const waitMs = Math.min(
        ((hint ? parseFloat(hint[1]) : 5 * (attempt + 1)) + 1) * 1000,
        40_000
      );
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`${label} failed: ${res.status} ${text}`);
  }
}

// Truncated gemini-embedding-001 vectors are not unit length; normalize so
// cosine distance in pgvector behaves.
function l2Normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

function embedRequest(text: string, taskType: EmbedTask) {
  return {
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: EMBED_DIMS,
  };
}

export async function embedText(
  apiKey: string,
  text: string,
  taskType: EmbedTask = "RETRIEVAL_QUERY"
): Promise<number[]> {
  const res = await geminiPost(
    `${BASE_URL}/models/${EMBED_MODEL}:embedContent?key=${apiKey}`,
    embedRequest(text, taskType),
    "Gemini embed"
  );
  const json = await res.json();
  return l2Normalize(json.embedding.values as number[]);
}

// Batch variant: one request for many chunks (caller keeps batches small enough
// to respect the free-tier tokens-per-minute limit).
export async function embedTexts(
  apiKey: string,
  texts: string[],
  taskType: EmbedTask = "RETRIEVAL_DOCUMENT"
): Promise<number[][]> {
  const res = await geminiPost(
    `${BASE_URL}/models/${EMBED_MODEL}:batchEmbedContents?key=${apiKey}`,
    { requests: texts.map((t) => embedRequest(t, taskType)) },
    "Gemini batch embed"
  );
  const json = await res.json();
  return (json.embeddings as { values: number[] }[]).map((e) =>
    l2Normalize(e.values)
  );
}

export type GeneratedAnswer = {
  answer: string;
  confidence: "high" | "low" | "unsure";
  sourceSnippet: string | null;
};

export async function generateAnswer(
  apiKey: string,
  question: string,
  contextChunks: { content: string; source: string }[]
): Promise<GeneratedAnswer> {
  const context = contextChunks
    .map((c, i) => `[Source ${i + 1} — ${c.source}]\n${c.content}`)
    .join("\n\n");

  const systemInstruction = `You answer multiple-choice or short-answer questions using ONLY the provided context from the student's own study material. Never use outside knowledge, never guess.

Rules:
- If the answer is clearly supported by the context, respond with just the answer (e.g. a single letter "A", "B", "C", "D", or a short phrase) on the first line, then on a second line write the exact sentence from the context that supports it (max 30 words), then on a third line write CONFIDENCE: HIGH.
- If the context partially supports an answer but isn't fully explicit, give your best answer, the closest supporting sentence, and CONFIDENCE: LOW.
- If the context does not contain information relevant to the question at all, respond with "UNSURE" on the first line, "N/A" on the second line, and CONFIDENCE: UNSURE.
- Never fabricate a supporting sentence that isn't actually in the context.`;

  const res = await geminiPost(
    `${BASE_URL}/models/${GENERATE_MODEL}:generateContent?key=${apiKey}`,
    {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [
        {
          role: "user",
          parts: [{ text: `Context:\n${context}\n\nQuestion:\n${question}` }],
        },
      ],
      generationConfig: { temperature: 0 },
    },
    "Gemini generate"
  );

  const json = await res.json();
  const parts: { text?: string; thought?: boolean }[] =
    json.candidates?.[0]?.content?.parts ?? [];
  const text: string = parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
  const lines = text.trim().split("\n").map((l: string) => l.trim());

  const answer = lines[0] ?? "UNSURE";
  const sourceSnippet = lines[1] && lines[1] !== "N/A" ? lines[1] : null;
  const confidenceLine = lines.find((l: string) => l.startsWith("CONFIDENCE:"));

  let confidence: GeneratedAnswer["confidence"] = "unsure";
  if (confidenceLine?.includes("HIGH")) confidence = "high";
  else if (confidenceLine?.includes("LOW")) confidence = "low";

  return { answer, confidence, sourceSnippet };
}

// Learn Mode: teaches one unit of a material in plain language with
// real-world examples, like explaining it to a secondary school student.
export async function teachUnit(
  apiKey: string,
  unitTitle: string,
  unitText: string
): Promise<string> {
  const systemInstruction = `You are a patient, friendly teacher explaining study material to a secondary school student. Use simple, everyday words — no big grammar, no unexplained jargon. Use real-world examples and analogies the student can relate to.

Study the material given below and teach it like this:
- Start with a short, simple summary of what this unit is about (2-3 sentences).
- Go through each heading and sub-heading in the material, IN ORDER, and teach each one.
- For each heading, explain it in plain simple language, then give at least one real-world example or everyday analogy that makes it click.
- Do not skip any heading or sub-heading that is in the material.
- Only teach what is actually in the material — don't add outside facts, just make what's there easier to understand.
- End with a short "Quick Recap" as a bullet list of the key points in this unit.

Keep a warm, encouraging tone, like a good teacher talking directly to the student.`;

  const res = await geminiPost(
    `${BASE_URL}/models/${GENERATE_MODEL}:generateContent?key=${apiKey}`,
    {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: `Unit title: ${unitTitle}\n\nMaterial for this unit:\n${unitText}` },
          ],
        },
      ],
      generationConfig: { temperature: 0.4 },
    },
    "Gemini teach unit"
  );

  const json = await res.json();
  const parts: { text?: string; thought?: boolean }[] =
    json.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
