"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, GraduationCap, Loader2 } from "lucide-react";
import LessonMarkdown from "@/components/LessonMarkdown";
import QuizPanel from "@/components/QuizPanel";
import { createClient } from "@/lib/supabase/client";
import { readFunctionError } from "@/lib/functionError";

type Lesson = {
  unitNumber: number;
  title: string;
  lesson: string;
  totalUnits: number;
  hasNext: boolean;
  hasPrev: boolean;
  moduleNumber: number;
  moduleTitle: string;
  unitInModule: number;
  unitsInModule: number;
  totalModules: number;
  isLastInModule: boolean;
  nextModuleTitle: string | null;
  partNumber: number;
  totalParts: number;
  isLastPartOfUnit: boolean;
  mode: "objective" | "theory";
};

export default function LearnClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [supabase] = useState(() => createClient());

  const materialId = searchParams.get("material");
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [moduleDone, setModuleDone] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Learn lives at /learn now; a reader with no course goes back there.
  useEffect(() => {
    if (!materialId) router.replace("/learn");
  }, [materialId, router]);

  // Lessons already fetched (or being fetched) this visit, keyed by unit number.
  // Next/Previous show these instantly instead of waiting on the server.
  const cache = useRef(new Map<number, Promise<Lesson>>());
  // Units fetched in the background: the server did not save progress for them.
  const prefetched = useRef(new Set<number>());

  const fetchUnit = useCallback(
    (unitNumber: number | undefined, prefetch: boolean): Promise<Lesson> => {
      const key = unitNumber ?? 0;
      const hit = key ? cache.current.get(key) : undefined;
      if (hit) return hit;
      const p = (async () => {
        const { data, error: fnError } = await supabase.functions.invoke("teach-unit", {
          body: { materialId, unitNumber, prefetch },
        });
        if (fnError) throw new Error(await readFunctionError(fnError));
        return data as Lesson;
      })();
      if (key) {
        if (prefetch) prefetched.current.add(key);
        cache.current.set(key, p);
        // never keep a failed request, so "Try again" really retries
        p.catch(() => {
          cache.current.delete(key);
          prefetched.current.delete(key);
        });
      }
      return p;
    },
    [materialId, supabase]
  );

  const loadUnit = useCallback(
    async (unitNumber?: number) => {
      if (!materialId) return;
      setLoading(true);
      setError(null);
      try {
        const data = await fetchUnit(unitNumber, false);
        cache.current.set(data.unitNumber, Promise.resolve(data));
        setModuleDone(false);
        setQuizOpen(false);
        setLesson(data);
        window.scrollTo({ top: 0 });
        // A background-fetched unit was not saved as "where you stopped" yet.
        if (prefetched.current.delete(data.unitNumber)) {
          supabase.functions
            .invoke("teach-unit", {
              body: { materialId, unitNumber: data.unitNumber, action: "save-progress" },
            })
            .catch(() => {});
        }
        // Warm up the next unit while the student reads this one.
        if (data.hasNext) fetchUnit(data.unitNumber + 1, true).catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [materialId, fetchUnit, supabase]
  );

  useEffect(() => {
    if (materialId) loadUnit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId]);

  function onNext() {
    if (!lesson) return;
    setQuizOpen(false);
    if (lesson.isLastInModule) {
      setModuleDone(true);
      window.scrollTo({ top: 0 });
      return;
    }
    loadUnit(lesson.unitNumber + 1);
  }

  return (
    <main className="min-h-screen bg-cream px-6 py-8 md:px-12">
      <div className="mx-auto max-w-2xl">
        <button
          onClick={() => router.back()}
          className="mb-4 flex items-center gap-2 text-sm text-muted"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <div className="mb-6 flex items-center gap-2">
          <GraduationCap size={22} className="text-wine" />
          <h1 className="text-2xl font-bold text-ink">Learn</h1>
        </div>

        {loading && !lesson ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-16 text-center shadow-sm">
            <Loader2 size={28} className="animate-spin text-wine" />
            <p className="text-sm text-muted">
              Reading the course and preparing your lesson…
            </p>
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-white px-6 py-8 text-center shadow-sm">
            <p className="mb-3 text-sm text-wine-dark">{error}</p>
            <button
              onClick={() => loadUnit(lesson?.unitNumber)}
              className="rounded-full border border-wine px-4 py-2 text-sm font-medium text-wine"
            >
              Try again
            </button>
          </div>
        ) : lesson && moduleDone ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-14 text-center shadow-sm">
            <CheckCircle2 size={44} className="text-wine" />
            <h2 className="font-serif text-2xl font-bold text-wine">
              {lesson.hasNext ? "Module completed" : "Course completed"}
            </h2>
            <p className="text-sm text-muted">
              {lesson.hasNext
                ? `You finished Module ${lesson.moduleNumber} (${lesson.unitsInModule} ${
                    lesson.unitsInModule === 1 ? "unit" : "units"
                  }).`
                : "You've gone through every module in this course. 🎉"}
            </p>
            {lesson.hasNext ? (
              <>
                {lesson.nextModuleTitle && (
                  <p className="text-sm font-medium text-ink">Next: {lesson.nextModuleTitle}</p>
                )}
                <button
                  onClick={() => loadUnit(lesson.unitNumber + 1)}
                  disabled={loading}
                  className="mt-2 flex items-center gap-1 rounded-full bg-wine px-6 py-2.5 text-sm font-medium text-cream shadow-md transition active:scale-95 disabled:opacity-40"
                >
                  {loading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <>
                      Start next module <ArrowRight size={16} />
                    </>
                  )}
                </button>
                <button
                  onClick={() => setModuleDone(false)}
                  className="text-xs text-muted underline"
                >
                  Review this module
                </button>
              </>
            ) : (
              <button
                onClick={() => router.push("/dashboard")}
                className="mt-2 rounded-full bg-wine px-6 py-2.5 text-sm font-medium text-cream shadow-md transition active:scale-95"
              >
                Back to dashboard
              </button>
            )}
          </div>
        ) : lesson && quizOpen && materialId ? (
          <QuizPanel
            materialId={materialId}
            unitNumber={lesson.unitNumber}
            continueLabel={lesson.isLastInModule ? "Finish module" : "Next unit"}
            onContinue={onNext}
            onBack={() => setQuizOpen(false)}
          />
        ) : lesson ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <p className="stat-display mb-1 text-xs uppercase tracking-wider text-muted">
              Module {lesson.moduleNumber} · Unit {lesson.unitInModule} of {lesson.unitsInModule}
              {lesson.totalParts > 1 && ` · Part ${lesson.partNumber} of ${lesson.totalParts}`}
            </p>
            <h2 className="mb-4 font-serif text-xl font-bold text-wine italic">{lesson.title}</h2>
            <div className="lesson-md text-sm leading-relaxed text-ink">
              <LessonMarkdown>{lesson.lesson}</LessonMarkdown>
            </div>

            {lesson.isLastPartOfUnit && (
              <div className="mt-8 rounded-xl border border-wine/20 bg-cream p-4 text-center">
                <p className="mb-1 text-sm font-semibold text-ink">Test yourself (optional)</p>
                <p className="mb-3 text-xs text-muted">
                  {lesson.mode === "objective"
                    ? "10 multiple-choice questions on this unit. Skip it any time."
                    : "4 written questions on this unit, marked for you. Skip it any time."}
                </p>
                <button
                  onClick={() => setQuizOpen(true)}
                  className="rounded-full border border-wine px-5 py-2 text-sm font-medium text-wine transition active:scale-95"
                >
                  Take the quiz
                </button>
              </div>
            )}

            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                disabled={!lesson.hasPrev || loading}
                onClick={() => loadUnit(lesson.unitNumber - 1)}
                className="rounded-full border border-cream-dark px-4 py-2 text-sm font-medium text-muted transition disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={loading}
                onClick={onNext}
                className="flex items-center gap-1 rounded-full bg-wine px-5 py-2 text-sm font-medium text-cream shadow-md transition active:scale-95 disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>
                    {lesson.isLastInModule ? "Finish module" : lesson.isLastPartOfUnit ? "Next unit" : "Next part"} <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
