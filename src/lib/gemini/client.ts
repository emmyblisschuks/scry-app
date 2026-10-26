/**
 * Thin client for Gemini's REST API, used from Edge Functions (Deno) only.
 * Never import this into client-side (browser) code — it expects
 * GEMINI_API_KEY to be present as a server-side secret.
 */

const EMBED_MODEL = "gemini-embedding-001"; // request outputDimensionality: 768
const GENERATE_MODEL = "gemini-flash-latest";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export async function embedText(apiKey: string, text: string): Promise<number[]> {
  const res = await fetch(
    `${BASE_URL}/models/${EMBED_MODEL}:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini embed failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  return json.embedding.values as number[];
}

export async function generateAnswer(
  apiKey: string,
  question: string,
  contextChunks: { content: string; source: string }[]
): Promise<{ answer: string; confidence: "high" | "low" | "unsure"; sourceSnippet: string | null }> {
  const context = contextChunks
    .map((c, i) => `[Source ${i + 1} — ${c.source}]\n${c.content}`)
    .join("\n\n");

  const systemInstruction = `You answer multiple-choice or short-answer questions using ONLY the provided context from the student's own study material. Never use outside knowledge, never guess.

Rules:
- If the answer is clearly supported by the context, respond with just the answer (e.g. a single letter "A", "B", "C", "D", or a short phrase) on the first line, then on a second line write the exact sentence from the context that supports it (max 30 words), then on a third line write CONFIDENCE: HIGH.
- If the context partially supports an answer but isn't fully explicit, give your best answer, the closest supporting sentence, and CONFIDENCE: LOW.
- If the context does not contain information relevant to the question at all, respond with "UNSURE" on the first line, "N/A" on the second line, and CONFIDENCE: UNSURE.
- Never fabricate a supporting sentence that isn't actually in the context.`;

  const res = await fetch(
    `${BASE_URL}/models/${GENERATE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Context:\n${context}\n\nQuestion:\n${question}`,
              },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini generate failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const lines = text.trim().split("\n").map((l: string) => l.trim());

  const answer = lines[0] ?? "UNSURE";
  const sourceSnippet = lines[1] && lines[1] !== "N/A" ? lines[1] : null;
  const confidenceLine = lines.find((l: string) => l.startsWith("CONFIDENCE:"));
  let confidence: "high" | "low" | "unsure" = "unsure";
  if (confidenceLine?.includes("HIGH")) confidence = "high";
  else if (confidenceLine?.includes("LOW")) confidence = "low";

  return { answer, confidence, sourceSnippet };
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
