"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { readFunctionError } from "@/lib/functionError";

type Mode = "objective" | "theory";
type QuizQuestion = { question: string; options?: string[] };

type ObjectiveResult = {
  question: string;
  options: string[];
  chosen: number | null;
  correctIndex: number;
  correct: boolean;
  explanation: string;
};
type TheoryResult = {
  question: string;
  answer: string;
  score: number;
  outOf: number;
  feedback: string;
  missed: string[];
  modelAnswer: string;
  points: string[];
};
type Result = {
  mode: Mode;
  score: number;
  total: number;
  results: (ObjectiveResult | TheoryResult)[];
};

const LETTERS = ["A", "B", "C", "D"];

export default function QuizPanel({
  materialId,
  unitNumber,
  continueLabel,
  onContinue,
  onBack,
}: {
  materialId: string;
  unitNumber: number;
  continueLabel: string;
  onContinue: () => void;
  onBack: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [mode, setMode] = useState<Mode>("objective");
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [answers, setAnswers] = useState<(number | string | null)[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: fnError } = await supabase.functions.invoke("teach-unit", {
        body: { action: "quiz-get", materialId, unitNumber },
      });
      if (cancelled) return;
      setLoading(false);
      if (fnError) {
        setError(await readFunctionError(fnError));
        return;
      }
      const q = (data as { mode: Mode; questions: QuizQuestion[] });
      setMode(q.mode);
      setQuestions(q.questions);
      setAnswers(q.questions.map(() => (q.mode === "objective" ? null : "")));
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, materialId, unitNumber]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke("teach-unit", {
      body: { action: "quiz-submit", materialId, unitNumber, answers },
    });
    setSubmitting(false);
    if (fnError) {
      setError(await readFunctionError(fnError));
      return;
    }
    setResult(data as Result);
    window.scrollTo({ top: 0 });
  }

  const answered = answers.filter((a) =>
    typeof a === "number" ? true : typeof a === "string" ? a.trim().length > 0 : false
  ).length;

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-16 text-center shadow-sm">
        <Loader2 size={28} className="animate-spin text-wine" />
        <p className="text-sm text-muted">Preparing your quiz…</p>
      </div>
    );
  }

  if (error && !questions) {
    return (
      <div className="rounded-2xl bg-white px-6 py-8 text-center shadow-sm">
        <p className="mb-3 text-sm text-wine-dark">{error}</p>
        <button onClick={onBack} className="rounded-full border border-wine px-4 py-2 text-sm font-medium text-wine">
          Back to lesson
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------- results
  if (result) {
    const pct = Math.round((result.score / result.total) * 100);
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Quiz result</p>
        <h2 className="stat-display mb-1 text-4xl text-wine">
          {result.score} / {result.total}
        </h2>
        <p className="mb-5 text-sm text-muted">
          <span className="stat-display text-base text-wine-dark">{pct}%</span>{" "}
          <em className="font-serif italic">
            {pct >= 70 ? "Great work." : pct >= 50 ? "Good effort, review what you missed." : "Go back over the lesson and try again."}
          </em>
        </p>

        <ol className="flex flex-col gap-5">
          {result.mode === "objective"
            ? (result.results as ObjectiveResult[]).map((r, i) => (
                <li key={i} className="rounded-xl border border-cream-dark p-4">
                  <p className="mb-2 flex items-start gap-2 text-sm font-medium text-ink">
                    {r.correct ? (
                      <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-600" />
                    ) : (
                      <XCircle size={18} className="mt-0.5 shrink-0 text-wine" />
                    )}
                    <span>
                      {i + 1}. {r.question}
                    </span>
                  </p>
                  <ul className="mb-2 flex flex-col gap-1.5">
                    {r.options.map((o, oi) => (
                      <li
                        key={oi}
                        className={`rounded-lg px-3 py-2 text-sm ${
                          oi === r.correctIndex
                            ? "bg-green-50 text-green-900"
                            : oi === r.chosen
                              ? "bg-wine/10 text-wine-dark"
                              : "text-muted"
                        }`}
                      >
                        <span className="font-semibold">{LETTERS[oi]}.</span> {o}
                        {oi === r.correctIndex && " ✓"}
                        {oi === r.chosen && oi !== r.correctIndex && " (your answer)"}
                      </li>
                    ))}
                  </ul>
                  {r.chosen === null && <p className="text-xs text-muted">You skipped this one.</p>}
                  {r.explanation && <p className="text-sm text-ink">{r.explanation}</p>}
                </li>
              ))
            : (result.results as TheoryResult[]).map((r, i) => (
                <li key={i} className="rounded-xl border border-cream-dark p-4">
                  <p className="mb-1 text-sm font-medium text-ink">
                    {i + 1}. {r.question}
                  </p>
                  <p className="mb-2 text-sm font-semibold text-wine">
                    {r.score} / {r.outOf}
                  </p>
                  <p className="mb-2 whitespace-pre-wrap rounded-lg bg-cream px-3 py-2 text-sm text-ink">
                    {r.answer.trim() || "(no answer)"}
                  </p>
                  {r.feedback && <p className="mb-2 text-sm text-ink">{r.feedback}</p>}
                  {r.missed.length > 0 && (
                    <div className="mb-2 text-sm">
                      <p className="font-medium text-ink">You missed:</p>
                      <ul className="list-disc pl-5 text-muted">
                        {r.missed.map((m, mi) => (
                          <li key={mi}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium text-wine">Model answer</summary>
                    <p className="mt-2 text-ink">{r.modelAnswer}</p>
                  </details>
                </li>
              ))}
        </ol>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="rounded-full border border-cream-dark px-4 py-2 text-sm font-medium text-muted"
          >
            Back to lesson
          </button>
          <button
            onClick={onContinue}
            className="rounded-full bg-wine px-5 py-2 text-sm font-medium text-cream shadow-md transition active:scale-95"
          >
            {continueLabel}
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ taking quiz
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
        Quiz · {mode === "objective" ? "Objective" : "Theory"} · optional
      </p>
      <h2 className="mb-4 font-serif text-xl font-bold text-wine">Test yourself</h2>

      <ol className="flex flex-col gap-5">
        {questions?.map((q, i) => (
          <li key={i}>
            <p className="mb-2 text-sm font-medium text-ink">
              {i + 1}. {q.question}
            </p>
            {mode === "objective" ? (
              <div className="flex flex-col gap-1.5">
                {q.options?.map((o, oi) => (
                  <button
                    key={oi}
                    type="button"
                    onClick={() => setAnswers((a) => a.map((v, vi) => (vi === i ? oi : v)))}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                      answers[i] === oi
                        ? "border-wine bg-wine/10 text-ink"
                        : "border-cream-dark text-ink hover:bg-cream"
                    }`}
                  >
                    <span className="font-semibold">{LETTERS[oi]}.</span> {o}
                  </button>
                ))}
              </div>
            ) : (
              <textarea
                rows={5}
                value={(answers[i] as string) ?? ""}
                onChange={(e) =>
                  setAnswers((a) => a.map((v, vi) => (vi === i ? e.target.value : v)))
                }
                placeholder="Type your answer…"
                className="w-full rounded-lg border border-cream-dark p-3 text-sm text-ink outline-none focus:border-wine"
              />
            )}
          </li>
        ))}
      </ol>

      {error && <p className="mt-4 text-sm text-wine-dark">{error}</p>}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="rounded-full border border-cream-dark px-4 py-2 text-sm font-medium text-muted"
        >
          Skip quiz
        </button>
        <button
          onClick={submit}
          disabled={submitting || answered === 0}
          className="flex items-center gap-2 rounded-full bg-wine px-5 py-2 text-sm font-medium text-cream shadow-md transition active:scale-95 disabled:opacity-40"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
          Submit ({answered}/{questions?.length ?? 0})
        </button>
      </div>
    </div>
  );
}
