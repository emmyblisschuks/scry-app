"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, GraduationCap, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { readFunctionError } from "@/lib/functionError";
import { hashFile } from "@/lib/fileHash";
import UploadZone, { FileChip } from "@/components/UploadZone";
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

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

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

  // Upload a material straight into Learn Mode — no need to run a Q&A set
  // first. Same memory/dedupe rules as the main workspace upload: an
  // identical file (here or in another of this student's workspaces) is
  // reused instead of re-processed.
  async function handleUploadForLearn(files: File[]) {
    const file = files[0];
    if (!file) return;
    setUploadFile(file);
    setUploadError(null);
    setUploadStage("Checking memory…");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUploadError("You need to be signed in.");
      setUploadStage(null);
      return;
    }

    let hash: string | null = null;
    try {
      hash = await hashFile(file);
    } catch (err) {
      console.error("hashing failed, treating as new", err);
    }

    try {
      let newMaterialId: string;

      const sameHere = hash
        ? materials.find((m) => m.content_hash === hash)
        : undefined;

      if (sameHere) {
        newMaterialId = sameHere.id;
      } else {
        const elsewhere = hash
          ? (
              await supabase
                .from("materials")
                .select("id, chunks_from")
                .eq("content_hash", hash)
                .not("indexed_at", "is", null)
                .neq("workspace_id", id)
                .limit(1)
            ).data?.[0]
          : undefined;

        if (elsewhere) {
          setUploadStage("Found this in your memory already…");
          const { data: row, error: insertError } = await supabase
            .from("materials")
            .insert({
              workspace_id: id,
              file_name: file.name,
              content_hash: hash,
              chunks_from: elsewhere.chunks_from ?? elsewhere.id,
              indexed_at: new Date().toISOString(),
              storage_path: null,
            })
            .select()
            .single();
          if (insertError || !row) throw new Error("Couldn't save this material.");
          newMaterialId = row.id;
        } else {
          setUploadStage("Uploading…");
          const materialPath = `${user.id}/${id}/${file.name}`;
          const { error: uploadErr } = await supabase.storage
            .from("materials")
            .upload(materialPath, file, { upsert: true });
          if (uploadErr) throw new Error(`Couldn't upload: ${uploadErr.message}`);

          const { data: row, error: insertError } = await supabase
            .from("materials")
            .insert({
              workspace_id: id,
              file_name: file.name,
              storage_path: materialPath,
              content_hash: hash,
            })
            .select()
            .single();
          if (insertError || !row) throw new Error("Couldn't save this material.");
          newMaterialId = row.id;

          // Resumable, rate-limit aware — same loop the Q&A flow uses.
          setUploadStage("Reading and processing material…");
          let done = false;
          let errors = 0;
          for (let pass = 0; !done && pass < 60; pass++) {
            const { data, error: fnError } = await supabase.functions.invoke(
              "process-material",
              { body: { materialId: newMaterialId } }
            );
            if (fnError) {
              if (++errors >= 3) throw new Error(await readFunctionError(fnError));
              await new Promise((r) => setTimeout(r, 5000));
              continue;
            }
            errors = 0;
            done = data?.done === true;
            if (!done && data?.rateLimited) {
              setUploadStage("Pausing briefly for rate limits…");
              await new Promise((r) => setTimeout(r, 20000));
              setUploadStage("Reading and processing material…");
            }
          }
          if (!done) throw new Error("Processing didn't finish — please try again.");
        }
      }

      setUploadStage(null);
      setMaterialId(newMaterialId);
    } catch (err) {
      console.error(err);
      setUploadError(err instanceof Error ? err.message : "Something went wrong.");
      setUploadStage(null);
    }
  }

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

            {materials.length > 0 && (
              <ul className="mb-4 flex flex-col gap-2">
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

            {uploadStage ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-10 text-center shadow-sm">
                <Loader2 size={24} className="animate-spin text-wine" />
                <p className="text-sm text-muted">{uploadStage}</p>
              </div>
            ) : uploadFile && uploadError ? (
              <>
                <FileChip
                  name={uploadFile.name}
                  size={`${(uploadFile.size / 1024 / 1024).toFixed(1)} MB`}
                  onRemove={() => {
                    setUploadFile(null);
                    setUploadError(null);
                  }}
                />
                <p className="mt-2 text-xs text-wine-dark">{uploadError}</p>
                <button
                  onClick={() => handleUploadForLearn([uploadFile])}
                  className="mt-2 text-xs font-medium text-wine underline"
                >
                  Try again
                </button>
              </>
            ) : (
              <>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                  {materials.length > 0 ? "Or upload a new one" : "Upload material to learn"}
                </p>
                <UploadZone kind="material" onFiles={handleUploadForLearn} />
              </>
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
