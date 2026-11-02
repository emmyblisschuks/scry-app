"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, GraduationCap, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
};

export default function LearnClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [supabase] = useState(() => createClient());

  const materialId = searchParams.get("material");
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [moduleDone, setModuleDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Learn lives at /learn now; a reader with no course goes back there.
  useEffect(() => {
    if (!materialId) router.replace("/learn");
  }, [materialId, router]);

  const loadUnit = useCallback(
    async (unitNumber?: number) => {
      if (!materialId) return;
      setLoading(true);
      setError(null);
      const { data, error: fnError } = await supabase.functions.invoke("teach-unit", {
        body: { materialId, unitNumber },
      });
      setLoading(false);
      if (fnError) {
        setError(await readFunctionError(fnError));
        return;
      }
      setModuleDone(false);
      setLesson(data as Lesson);
      window.scrollTo({ top: 0 });
    },
    [materialId, supabase]
  );

  useEffect(() => {
    if (materialId) loadUnit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId]);

  function onNext() {
    if (!lesson) return;
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
          onClick={() => router.push("/learn")}
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
        ) : lesson ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
              Module {lesson.moduleNumber} · Unit {lesson.unitInModule} of {lesson.unitsInModule}
            </p>
            <h2 className="mb-4 font-serif text-xl font-bold text-wine">{lesson.title}</h2>
            <div className="lesson-md text-sm leading-relaxed text-ink">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{lesson.lesson}</ReactMarkdown>
            </div>

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
                    {lesson.isLastInModule ? "Finish module" : "Next"} <ArrowRight size={16} />
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
