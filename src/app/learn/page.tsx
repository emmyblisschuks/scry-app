"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, GraduationCap, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import UploadZone, { FileChip } from "@/components/UploadZone";
import { LearnCourse, loadLearnCourses, learnHref, whereYouStopped } from "@/lib/learnCourses";
import { uploadWithProgress } from "@/lib/uploadWithProgress";

export default function LearnHomePage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [courses, setCourses] = useState<LearnCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"objective" | "theory" | null>(null);
  const [ready, setReady] = useState<{ href: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setCourses(await loadLearnCourses(supabase));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // Each uploaded course gets its own Learn workspace. The file is only
  // stored here; teach-unit reads and splits it into modules/units the first
  // time the course is opened.
  async function handleUpload(files: File[]) {
    const f = files[0];
    if (!f) return;
    if (!mode) {
      setError("Choose Objective or Theory first.");
      return;
    }
    setFile(f);
    setError(null);
    setStage("Uploading… 0%");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user || !session) throw new Error("You need to be signed in.");

      const name = f.name.replace(/\.(pdf|docx)$/i, "");
      const { data: ws, error: wsErr } = await supabase
        .from("workspaces")
        .insert({ user_id: user.id, name, subject_tag: null, kind: "learn" })
        .select()
        .single();
      if (wsErr || !ws) throw new Error(wsErr?.message ?? "Couldn't create the course.");

      const path = `${user.id}/${ws.id}/${f.name}`;
      // A multi-MB PDF over a slow connection can take a while; a real
      // percentage (instead of a plain "Uploading…" spinner) is the
      // difference between "this is working" and "this looks frozen".
      await uploadWithProgress("materials", path, f, session.access_token, (pct) =>
        setStage(`Uploading… ${pct}%`)
      );

      const { data: mat, error: matErr } = await supabase
        .from("materials")
        .insert({ workspace_id: ws.id, file_name: f.name, storage_path: path, learn_mode: mode })
        .select()
        .single();
      if (matErr || !mat) throw new Error("Couldn't save this material.");

      // Pre-warm: split the course into units and teach its first unit now,
      // while the student is still looking at the upload screen, instead of
      // leaving all of that (PDF parsing + segmenting + the first Gemini
      // lesson call) to happen the moment they tap "Learn this course" —
      // that's the wait that used to show up as "Learn takes forever".
      // Best-effort: if it fails or times out here, the lesson simply
      // generates on first open as before.
      setStage("Preparing your first lesson…");
      try {
        await supabase.functions.invoke("teach-unit", {
          body: { materialId: mat.id, unitNumber: 1 },
        });
      } catch (warmErr) {
        console.error("pre-warm failed (non-fatal)", warmErr);
      }

      setStage(null);
      setFile(null);
      setReady({ href: `/workspace/${ws.id}/learn?material=${mat.id}`, name });
      load();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStage(null);
    }
  }

  return (
    <main className="min-h-screen bg-cream px-6 py-8 md:px-12">
      <div className="mx-auto max-w-2xl">
        <button
          onClick={() => router.back()}
          className="mb-4 flex items-center gap-2 text-sm text-muted"
        >
          <ArrowLeft size={16} /> Dashboard
        </button>

        <div className="mb-6 flex items-center gap-2">
          <GraduationCap size={22} className="text-wine" />
          <h1 className="text-2xl font-bold text-ink">Learn</h1>
        </div>

        {ready ? (
          <div className="mb-8 rounded-2xl bg-white p-6 text-center shadow-sm">
            <p className="mb-1 text-sm text-muted">Uploaded</p>
            <p className="mb-4 truncate font-semibold text-ink">{ready.name}</p>
            <button
              onClick={() => router.push(ready.href)}
              className="rounded-full bg-wine px-6 py-2.5 text-sm font-medium text-cream shadow-md transition active:scale-95"
            >
              Learn this course
            </button>
            <button
              onClick={() => setReady(null)}
              className="mt-3 block w-full text-xs text-muted underline"
            >
              Upload another
            </button>
          </div>
        ) : stage ? (
          <div className="mb-8 flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-10 text-center shadow-sm">
            <Loader2 size={24} className="animate-spin text-wine" />
            <p className="text-sm text-muted">{stage}</p>
          </div>
        ) : (
          <section className="mb-8">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
              Upload course material
            </p>
            {file && error ? (
              <>
                <FileChip
                  name={file.name}
                  size={`${(file.size / 1024 / 1024).toFixed(1)} MB`}
                  onRemove={() => {
                    setFile(null);
                    setError(null);
                  }}
                />
                <p className="mt-2 text-xs text-wine-dark">{error}</p>
                <button
                  onClick={() => handleUpload([file])}
                  className="mt-2 text-xs font-medium text-wine underline"
                >
                  Try again
                </button>
              </>
            ) : (
              <>
                <ModePicker mode={mode} onChange={(m) => { setMode(m); setError(null); }} />
                <div className={mode ? "" : "pointer-events-none opacity-50"}>
                  <UploadZone kind="material" onFiles={handleUpload} />
                </div>
                {!mode && error && <p className="mt-2 text-xs text-wine-dark">{error}</p>}
              </>
            )}
          </section>
        )}

        <h2 className="mb-3 text-lg font-bold text-ink">My courses</h2>
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : courses.length === 0 ? (
          <p className="text-sm text-muted">
            No courses yet. Upload your course material above and tap Learn this course.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {courses.map((c) => (
              <li key={c.materialId}>
                <button
                  onClick={() => router.push(learnHref(c))}
                  className="w-full rounded-xl bg-white px-4 py-3 text-left shadow-sm transition hover:shadow-md"
                >
                  <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                  <span className="text-xs text-muted">{whereYouStopped(c)}</span>
                  {c.currentUnit > 0 && (
                    <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-wine/10">
                      <span
                        className="block h-full rounded-full bg-wine"
                        style={{ width: `${Math.max(c.percent, 3)}%` }}
                      />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function ModePicker({
  mode,
  onChange,
}: {
  mode: "objective" | "theory" | null;
  onChange: (m: "objective" | "theory") => void;
}) {
  const options = [
    {
      id: "objective" as const,
      title: "Objective",
      hint: "100 and 200 level. Multiple-choice exam focus.",
    },
    {
      id: "theory" as const,
      title: "Theory",
      hint: "300 level. Written exam focus.",
    },
  ];
  return (
    <div className="mb-3">
      <p className="mb-2 text-sm font-medium text-ink">What are you studying for?</p>
      <div className="grid grid-cols-2 gap-3">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={mode === o.id}
            className={`rounded-xl border p-3 text-left transition ${
              mode === o.id
                ? "border-wine bg-wine/10"
                : "border-cream-dark bg-white hover:bg-cream"
            }`}
          >
            <span className="block text-sm font-semibold text-ink">{o.title}</span>
            <span className="text-xs text-muted">{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
