"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, GraduationCap, List, Loader2, Menu } from "lucide-react";
import LessonMarkdown from "@/components/LessonMarkdown";
import QuizPanel from "@/components/QuizPanel";
import { createClient } from "@/lib/supabase/client";
import { readFunctionError } from "@/lib/functionError";
import ContentsSheet from "@/components/reader/ContentsSheet";
import ReaderSettingsSheet from "@/components/reader/ReaderSettingsSheet";
import { cleanHeading, loadOutline, OutlineModule } from "@/lib/readerOutline";
import { stripLeadingHeading } from "@/lib/lessonText";
import {
  fontById,
  MARGIN_PADDING,
  themeById,
  useReaderSettings,
} from "@/lib/readerSettings";

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

  // Book-style reader: contents (all modules and units) + look settings.
  const settings = useReaderSettings();
  const theme = themeById(settings.theme);
  const font = fontById(settings.font);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [outline, setOutline] = useState<OutlineModule[] | null>(null);
  const [outlineError, setOutlineError] = useState<string | null>(null);

  const openContents = useCallback(async () => {
    setContentsOpen(true);
    if (!materialId) return;
    try {
      setOutlineError(null);
      setOutline(await loadOutline(supabase, materialId));
    } catch (e) {
      setOutlineError(e instanceof Error ? e.message : "Couldn't load the contents.");
    }
  }, [materialId, supabase]);

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

  const reading = !!lesson && !error && !moduleDone && !quizOpen;
  const themeVars = {
    "--r-bg": theme.bg,
    "--r-fg": theme.fg,
    "--r-muted": theme.muted,
    "--r-rule": theme.rule,
    "--r-accent": theme.accent,
    "--r-panel": theme.panel,
  } as React.CSSProperties;

  function pickUnit(unitNumber: number) {
    setContentsOpen(false);
    if (lesson && unitNumber === lesson.unitNumber) return;
    loadUnit(unitNumber);
  }

  return (
    <main
      className={reading ? "min-h-screen" : "min-h-screen bg-cream px-6 py-8 md:px-12"}
      style={reading ? { ...themeVars, background: "var(--r-bg)", color: "var(--r-fg)" } : undefined}
    >
      {reading && lesson ? (
        <>
          {/* Top bar: back, tappable "Module · Unit" line that opens the contents */}
          <div
            className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b px-3 py-2 backdrop-blur"
            style={{ borderColor: "var(--r-rule)", background: "color-mix(in srgb, var(--r-bg) 88%, transparent)" }}
          >
            <button
              onClick={() => router.back()}
              aria-label="Back"
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ color: "var(--r-fg)" }}
            >
              <ArrowLeft size={20} />
            </button>
            <button
              onClick={openContents}
              className="flex min-w-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
              style={{ color: "var(--r-fg)" }}
              aria-label="Open contents"
            >
              <List size={16} />
              <span className="truncate">
                Module {lesson.moduleNumber} · Unit {lesson.unitInModule}
              </span>
              <ChevronDown size={16} />
            </button>
            <div className="flex h-10 w-10 items-center justify-center">
              {loading && <Loader2 size={18} className="animate-spin" style={{ color: "var(--r-muted)" }} />}
            </div>
          </div>

          <article
            className="mx-auto w-full max-w-[40rem] pb-40 pt-10"
            style={{ paddingInline: MARGIN_PADDING[settings.margin] }}
          >
            <header className="mb-10 text-center">
              <button
                onClick={openContents}
                className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.22em]"
                style={{ color: "var(--r-muted)" }}
              >
                Module {lesson.moduleNumber} · Unit {lesson.unitInModule} of {lesson.unitsInModule}
                {lesson.totalParts > 1 && ` · Part ${lesson.partNumber} of ${lesson.totalParts}`}
                <ChevronDown size={14} />
              </button>
              <h1
                className="font-serif text-[2rem] font-bold italic leading-tight"
                style={{ color: "var(--r-accent)", fontFamily: "var(--font-fraunces), Georgia, serif" }}
              >
                {cleanHeading(lesson.title, "UNIT")}
              </h1>
              <div className="reader-ornament mt-6" aria-hidden="true">
                <span />
              </div>
            </header>

            <div
              className="lesson-md reader-md"
              style={{
                fontFamily: font.family,
                fontSize: `${settings.fontSize}px`,
                lineHeight: settings.lineHeight,
                fontWeight: theme.bold ? 600 : 400,
              }}
            >
              <LessonMarkdown>{stripLeadingHeading(lesson.lesson)}</LessonMarkdown>
            </div>

            {lesson.isLastPartOfUnit && (
              <div
                className="mt-12 rounded-2xl p-5 text-center"
                style={{ background: "var(--r-panel)", border: "1px solid var(--r-rule)" }}
              >
                <p className="mb-1 text-base font-semibold">Test yourself (optional)</p>
                <p className="mb-4 text-sm" style={{ color: "var(--r-muted)" }}>
                  {lesson.mode === "objective"
                    ? "10 multiple-choice questions on this unit. Skip it any time."
                    : "4 written questions on this unit, marked for you. Skip it any time."}
                </p>
                <button
                  onClick={() => setQuizOpen(true)}
                  className="rounded-full border-2 px-6 py-2.5 text-sm font-semibold"
                  style={{ borderColor: "var(--r-accent)", color: "var(--r-accent)" }}
                >
                  Take the quiz
                </button>
              </div>
            )}

            <div className="mt-10 flex items-center justify-between gap-3">
              <button
                disabled={!lesson.hasPrev || loading}
                onClick={() => loadUnit(lesson.unitNumber - 1)}
                className="rounded-full border-2 px-5 py-2.5 text-sm font-semibold disabled:opacity-30"
                style={{ borderColor: "var(--r-rule)", color: "var(--r-fg)" }}
              >
                Previous
              </button>
              <button
                disabled={loading}
                onClick={onNext}
                className="flex items-center gap-1 rounded-full px-6 py-2.5 text-sm font-semibold shadow-md disabled:opacity-40"
                style={{ background: "var(--r-fg)", color: "var(--r-bg)" }}
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>
                    {lesson.isLastInModule ? "Finish module" : lesson.isLastPartOfUnit ? "Next unit" : "Next part"}{" "}
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </article>

          {/* Hamburger: opens the themes and settings sheet */}
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Themes and settings"
            className="fixed bottom-6 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-xl"
            style={{ background: "var(--r-fg)", color: "var(--r-bg)", bottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
          >
            <Menu size={24} />
          </button>

          {contentsOpen && (
            <ContentsSheet
              open
              onClose={() => setContentsOpen(false)}
              modules={outline}
              error={outlineError}
              currentModule={lesson.moduleNumber}
              currentUnit={lesson.unitNumber}
              onPick={pickUnit}
            />
          )}
          <ReaderSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} />
        </>
      ) : (
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
        ) : null}
      </div>
      )}
    </main>
  );
}
