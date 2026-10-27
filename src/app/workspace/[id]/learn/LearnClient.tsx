"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, GraduationCap, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { readFunctionError } from "@/lib/functionError";
import { Material } from "@/lib/types";

type Lesson = {
  unitNumber: number;
  title: string;
  lesson: string;
  totalUnits: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export default function LearnClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const materialParam = searchParams.get("material");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialId, setMaterialId] = useState<string | null>(materialParam);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (materialId) return;
    supabase
      .from("materials")
      .select("*")
      .eq("workspace_id", id)
      .not("indexed_at", "is", null)
      .order("uploaded_at", { ascending: false })
      .then(({ data }) => setMaterials((data as Material[]) ?? []));
  }, [id, materialId, supabase]);

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
      setLesson(data as Lesson);
    },
    [materialId, supabase]
  );

  useEffect(() => {
    if (materialId) loadUnit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId]);

  return (
    <main className="min-h-screen bg-cream px-6 py-8 md:px-12">
      <div className="mx-auto max-w-2xl">
        <button
          onClick={() =>
            materialId && !materialParam
              ? (setMaterialId(null), setLesson(null))
              : router.push(`/workspace/${id}`)
          }
          className="mb-4 flex items-center gap-2 text-sm text-muted"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <div className="mb-6 flex items-center gap-2">
          <GraduationCap size={22} className="text-wine" />
          <h1 className="text-2xl font-bold text-ink">Learn</h1>
        </div>

        {!materialId ? (
          <section>
            <p className="mb-3 text-sm text-muted">
              Pick a material and Scry will teach it to you unit by unit, in
              simple language with real-world examples.
            </p>
            {materials.length === 0 ? (
              <p className="rounded-xl bg-white px-4 py-3 text-sm text-muted shadow-sm">
                No processed material yet. Upload one and generate answers
                once first — Learn Mode reuses that same memory.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {materials.map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => setMaterialId(m.id)}
                      className="w-full rounded-xl bg-white px-4 py-3 text-left text-sm font-medium text-ink shadow-sm transition hover:shadow-md"
                    >
                      {m.file_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : loading && !lesson ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-16 text-center shadow-sm">
            <Loader2 size={28} className="animate-spin text-wine" />
            <p className="text-sm text-muted">
              Studying the material and preparing your lesson…
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
        ) : lesson ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
              Unit {lesson.unitNumber} of {lesson.totalUnits}
            </p>
            <h2 className="mb-4 font-serif text-xl font-bold text-wine">
              {lesson.title}
            </h2>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {lesson.lesson}
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
                disabled={!lesson.hasNext || loading}
                onClick={() => loadUnit(lesson.unitNumber + 1)}
                className="flex items-center gap-1 rounded-full bg-wine px-5 py-2 text-sm font-medium text-cream shadow-md transition active:scale-95 disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>
                    Next <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
            {!lesson.hasNext && (
              <p className="mt-3 text-center text-xs text-muted">
                That&apos;s the last unit in this material. 🎉
              </p>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
