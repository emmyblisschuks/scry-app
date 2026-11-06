import { getLessonPrompt, type LearnMode } from "./lesson-prompt.ts";
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

// Optional fallback for text generation (teaching, quizzes, grading, Q&A).
// Any OpenAI-compatible /chat/completions endpoint works here: OpenRouter,
// Groq, Together, Fireworks, or OpenAI itself. Unset FALLBACK_API_KEY means
// no fallback — Gemini errors surface as before. Set with e.g.:
// openrouter/free is OpenRouter's own router: it picks a free model for you
// at $0, so it never goes stale the way naming one specific free model does.
//   supabase secrets set FALLBACK_API_KEY=sk-or-...
const FALLBACK_API_KEY = Deno.env.get("FALLBACK_API_KEY");
const FALLBACK_BASE_URL = (Deno.env.get("FALLBACK_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
const FALLBACK_MODEL = Deno.env.get("FALLBACK_MODEL") ?? "openrouter/free";

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

  const text = await generateText(
    apiKey,
    systemInstruction,
    `Context:\n${context}\n\nQuestion:\n${question}`,
    "Gemini generate",
    { temperature: 0 }
  );
  const lines = text.trim().split("\n").map((l: string) => l.trim());

  const answer = lines[0] ?? "UNSURE";
  const sourceSnippet = lines[1] && lines[1] !== "N/A" ? lines[1] : null;
  const confidenceLine = lines.find((l: string) => l.startsWith("CONFIDENCE:"));

  let confidence: GeneratedAnswer["confidence"] = "unsure";
  if (confidenceLine?.includes("HIGH")) confidence = "high";
  else if (confidenceLine?.includes("LOW")) confidence = "low";

  return { answer, confidence, sourceSnippet };
}

// ---------------------------------------------------------------------------
// Learn Mode
// ---------------------------------------------------------------------------

type GenOpts = { temperature?: number; json?: boolean; maxOutputTokens?: number };

// One text-generation call against Gemini. Throws (so nothing half-finished
// is ever cached) if the model stopped early or returned nothing.
async function generateViaGemini(
  apiKey: string,
  systemInstruction: string,
  userText: string,
  label: string,
  opts: GenOpts
): Promise<string> {
  const res = await geminiPost(
    `${BASE_URL}/models/${GENERATE_MODEL}:generateContent?key=${apiKey}`,
    {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.maxOutputTokens ?? 32768,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
      },
    },
    label
  );
  const json = await res.json();
  const candidate = json.candidates?.[0];
  const parts: { text?: string; thought?: boolean }[] = candidate?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  const reason: string | undefined = candidate?.finishReason;
  if (reason === "MAX_TOKENS") {
    throw new Error(`${label}: the answer was cut off before it finished. Please try again.`);
  }
  if (!text) {
    throw new Error(`${label}: the model returned nothing${reason ? ` (${reason})` : ""}. Please try again.`);
  }
  return text;
}

// Same call against the OpenAI-compatible fallback endpoint. Only used when
// FALLBACK_API_KEY is set and Gemini has already failed (including its own
// 429/503 retries).
async function generateViaFallback(
  systemInstruction: string,
  userText: string,
  label: string,
  opts: GenOpts
): Promise<string> {
  const res = await fetch(`${FALLBACK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FALLBACK_API_KEY}`,
    },
    body: JSON.stringify({
      model: FALLBACK_MODEL,
      temperature: opts.temperature ?? 0.4,
      max_tokens: Math.min(opts.maxOutputTokens ?? 8000, 8000),
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userText },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${label} (fallback model) failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  const text: string | undefined = json.choices?.[0]?.message?.content?.trim();
  const reason: string | undefined = json.choices?.[0]?.finish_reason;
  if (reason === "length") {
    throw new Error(`${label} (fallback model): the answer was cut off before it finished. Please try again.`);
  }
  if (!text) {
    throw new Error(`${label} (fallback model): the model returned nothing. Please try again.`);
  }
  return text;
}

// Tries Gemini first; if it fails (rate-limited, down, or any other error)
// and a fallback model is configured, retries once on that model instead of
// failing the whole request.
async function generateText(
  apiKey: string,
  systemInstruction: string,
  userText: string,
  label: string,
  opts: GenOpts = {}
): Promise<string> {
  try {
    return await generateViaGemini(apiKey, systemInstruction, userText, label, opts);
  } catch (err) {
    if (!FALLBACK_API_KEY) throw err;
    console.error(`${label}: Gemini failed, trying fallback model (${FALLBACK_MODEL}). Cause: ${err}`);
    return await generateViaFallback(systemInstruction, userText, label, opts);
  }
}

export type PartInfo = {
  mode: LearnMode;
  partNumber: number;
  totalParts: number;
  contextBefore?: string; // tail of the previous part, for continuity only
};

// Teaches one unit (or one part of a long unit) using the guardrail prompt for
// the course's mode (objective or theory).
export async function teachUnit(
  apiKey: string,
  unitTitle: string,
  unitText: string,
  info: PartInfo
): Promise<string> {
  const { mode, partNumber, totalParts, contextBefore } = info;
  const where =
    totalParts > 1
      ? `This is Part ${partNumber} of ${totalParts} of this unit. ${
          partNumber === totalParts ? "It is the FINAL part." : "It is NOT the final part."
        }`
      : "This is a complete unit in a single part.";
  const context = contextBefore
    ? `Context only (end of the previous part, do not teach it again):\n${contextBefore}\n\n`
    : "";

  return generateText(
    apiKey,
    getLessonPrompt(mode),
    `Unit title: ${unitTitle}\n${where}\n\n${context}Material for this part:\n${unitText}`,
    "Gemini teach unit"
  );
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------

export type ObjectiveQuestion = {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
};
export type TheoryQuestion = {
  question: string;
  modelAnswer: string;
  points: string[];
};

const OBJECTIVE_QUIZ_PROMPT = `You write multiple-choice practice questions for a National Open University of Nigeria (NOUN) student, using ONLY the unit text you are given. Reply with JSON only, in exactly this shape:
{"questions":[{"question":"...","options":["...","...","...","..."],"answerIndex":0,"explanation":"..."}]}

Rules:
- Exactly 10 questions that cover the unit's most important facts across the WHOLE unit, not just the start.
- One fact per question. Every question must be answerable from the unit text alone.
- Exactly 4 options. One is correct. The other three must be plausible, similar in length, wording and form, and based on real mix-ups or look-alike terms from the text.
- No "all of the above" or "none of the above". Avoid negative stems. Do not give away the answer in the question wording.
- "answerIndex" is the position (0 to 3) of the correct option.
- "explanation" is one or two sentences: why the answer is correct and why the closest wrong option is wrong.
- Do not use outside knowledge. Do not invent facts.`;

const THEORY_QUIZ_PROMPT = `You write theory (written-exam) practice questions for a National Open University of Nigeria (NOUN) student, using ONLY the unit text you are given. Reply with JSON only, in exactly this shape:
{"questions":[{"question":"...","modelAnswer":"...","points":["...","..."]}]}

Rules:
- Exactly 4 questions that cover the most important ideas across the WHOLE unit. Mix kinds: define or explain, list and describe, compare or distinguish, apply or discuss.
- Every question must be answerable from the unit text alone.
- "modelAnswer" is a clear answer of 80 to 150 words written only from the unit text.
- "points" is 3 to 5 short marking points the unit text supports. A full-mark answer covers them.
- Do not use outside knowledge. Do not invent facts.`;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}

export async function generateQuiz(
  apiKey: string,
  mode: LearnMode,
  unitTitle: string,
  unitText: string
): Promise<ObjectiveQuestion[] | TheoryQuestion[]> {
  const raw = await generateText(
    apiKey,
    mode === "objective" ? OBJECTIVE_QUIZ_PROMPT : THEORY_QUIZ_PROMPT,
    `Unit title: ${unitTitle}\n\nUnit text:\n${unitText}`,
    "Gemini quiz",
    { temperature: 0.5, json: true }
  );
  const data = parseJson(raw) as { questions?: unknown[] };
  const qs = Array.isArray(data.questions) ? data.questions : [];

  if (mode === "objective") {
    const out: ObjectiveQuestion[] = [];
    for (const q of qs as Partial<ObjectiveQuestion>[]) {
      if (
        typeof q.question === "string" &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        q.options.every((o) => typeof o === "string" && o.trim()) &&
        Number.isInteger(q.answerIndex) &&
        q.answerIndex! >= 0 &&
        q.answerIndex! < 4
      ) {
        // shuffle options so the answer position isn't biased by the model
        const correct = q.options[q.answerIndex!];
        const options = shuffle(q.options);
        out.push({
          question: q.question,
          options,
          answerIndex: options.indexOf(correct),
          explanation: typeof q.explanation === "string" ? q.explanation : "",
        });
      }
    }
    if (out.length < 5) throw new Error("Couldn't build a good quiz for this unit. Please try again.");
    return out.slice(0, 10);
  }

  const out: TheoryQuestion[] = [];
  for (const q of qs as Partial<TheoryQuestion>[]) {
    if (
      typeof q.question === "string" &&
      typeof q.modelAnswer === "string" &&
      Array.isArray(q.points) &&
      q.points.length > 0
    ) {
      out.push({
        question: q.question,
        modelAnswer: q.modelAnswer,
        points: q.points.filter((p) => typeof p === "string"),
      });
    }
  }
  if (out.length < 2) throw new Error("Couldn't build a good quiz for this unit. Please try again.");
  return out.slice(0, 4);
}

export type TheoryGrade = { score: number; feedback: string; missed: string[] };

const THEORY_GRADE_PROMPT = `You mark a NOUN student's written answers. For each question you get the question, the marking points and model answer (both taken from the student's own course material), and the student's answer. Reply with JSON only, in exactly this shape:
{"results":[{"score":0,"feedback":"...","missed":["..."]}]}

Rules:
- One result per question, in the same order.
- "score" is a whole number from 0 to 10, based on how many of the marking points the answer covers correctly and how clearly. Credit correct meaning even if the wording differs.
- Do not give credit for claims that are not supported by the marking points or model answer, and do not reward padding.
- A blank or irrelevant answer scores 0.
- "feedback" is 1 to 3 warm, specific sentences: what was good and what to improve.
- "missed" lists the marking points the answer did not cover (empty if none).`;

export async function gradeTheory(
  apiKey: string,
  items: { question: string; modelAnswer: string; points: string[]; studentAnswer: string }[]
): Promise<TheoryGrade[]> {
  const body = items
    .map(
      (it, i) =>
        `Question ${i + 1}: ${it.question}\nMarking points: ${it.points.join(" | ")}\nModel answer: ${it.modelAnswer}\nStudent answer: ${it.studentAnswer.trim() || "(blank)"}`
    )
    .join("\n\n");
  const raw = await generateText(apiKey, THEORY_GRADE_PROMPT, body, "Gemini grade", {
    temperature: 0.2,
    json: true,
  });
  const data = parseJson(raw) as { results?: Partial<TheoryGrade>[] };
  const results = Array.isArray(data.results) ? data.results : [];
  return items.map((_, i) => {
    const r = results[i] ?? {};
    const score = Math.min(10, Math.max(0, Math.round(Number(r.score) || 0)));
    return {
      score,
      feedback: typeof r.feedback === "string" ? r.feedback : "",
      missed: Array.isArray(r.missed) ? r.missed.filter((m) => typeof m === "string") : [],
    };
  });
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
