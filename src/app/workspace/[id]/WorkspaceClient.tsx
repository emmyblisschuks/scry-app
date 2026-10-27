"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, AlertTriangle, Sparkles, DatabaseZap, History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { detectBlur } from "@/lib/blurDetection";
import { extractText } from "@/lib/ocr";
import UploadZone, { FileChip } from "@/components/UploadZone";
import QuestionThumb from "@/components/QuestionThumb";
import PasteQuestions from "@/components/PasteQuestions";
import { hashFile } from "@/lib/fileHash";
import { Material, QuestionImage } from "@/lib/types";

// What to do with a newly picked study-material file, decided by its hash:
//  reuse  - identical file already indexed in THIS workspace (skip everything)
//  link   - identical file already indexed in ANOTHER workspace (point at its chunks)
//  update - same file name here, new content (re-embed only changed chunks)
//  new    - never seen before
type MaterialPlan =
  | { kind: "new"; file: File; hash: string | null }
  | { kind: "update"; file: File; hash: string | null; target: Material }
  | { kind: "reuse"; file: File; hash: string; target: Material }
  | { kind: "link"; file: File; hash: string; sourceId: string; fromWorkspace: string };

export default function WorkspaceClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [workspaceName, setWorkspaceName] = useState("");
  const [subjectTag, setSubjectTag] = useState<string | null>(null);
  const [plan, setPlan] = useState<MaterialPlan | null>(null);
  const [allMaterials, setAllMaterials] = useState<Material[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [checkingFile, setCheckingFile] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [pastSets, setPastSets] = useState<
    { id: string; created_at: string; count: number }[]
  >([]);
  const [questionImages, setQuestionImages] = useState<QuestionImage[]>([]);
  const [textQuestions, setTextQuestions] = useState<
    { id: string; text: string }[]
  >([]);
  const [starting, setStarting] = useState(false);

  const loadWorkspace = useCallback(async () => {
    const { data } = await supabase
      .from("workspaces")
      .select("name, subject_tag")
      .eq("id", id)
      .single();
    if (data) {
      setWorkspaceName(data.name);
      setSubjectTag(data.subject_tag);
    }

    // what this workspace already remembers
    const { data: mats } = await supabase
      .from("materials")
      .select("*")
      .eq("workspace_id", id)
      .order("uploaded_at", { ascending: false });
    setAllMaterials((mats as Material[]) ?? []);

    // finished runs, so earlier answers are one tap away
    const { data: sets } = await supabase
      .from("question_sets")
      .select("id, created_at, questions(answers(count))")
      .eq("workspace_id", id)
      .eq("status", "done")
      .order("created_at", { ascending: false });
    type SetRow = {
      id: string;
      created_at: string;
      questions?: { answers?: { count: number }[] }[];
    };
    setPastSets(
      ((sets as SetRow[]) ?? [])
        .map((r) => ({
          id: r.id,
          created_at: r.created_at,
          count:
            r.questions?.reduce((n, q) => n + (q.answers?.[0]?.count ?? 0), 0) ?? 0,
        }))
        .filter((r) => r.count > 0)
    );
  }, [id, supabase]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  async function handleMaterial(files: File[]) {
    const file = files[0];
    if (!file) return;
    setCheckingFile(true);
    setGenError(null);

    let hash: string | null = null;
    try {
      hash = await hashFile(file);
    } catch (err) {
      console.error("hashing failed, treating as new", err);
    }

    let next: MaterialPlan = { kind: "new", file, hash };
    if (hash) {
      const sameHere = allMaterials.find((m) => m.content_hash === hash);
      if (sameHere) {
        next = { kind: "reuse", file, hash, target: sameHere };
      } else {
        const { data: elsewhere } = await supabase
          .from("materials")
          .select("id, chunks_from, workspaces(name)")
          .eq("content_hash", hash)
          .not("indexed_at", "is", null)
          .neq("workspace_id", id)
          .limit(1);
        const src = elsewhere?.[0] as
          | { id: string; chunks_from: string | null; workspaces: { name: string } | { name: string }[] | null }
          | undefined;
        if (src) {
          const ws = Array.isArray(src.workspaces) ? src.workspaces[0] : src.workspaces;
          next = {
            kind: "link",
            file,
            hash,
            sourceId: src.chunks_from ?? src.id,
            fromWorkspace: ws?.name ?? "another workspace",
          };
        }
      }
    }
    if (next.kind === "new") {
      const sameName = allMaterials.find((m) => m.file_name === file.name);
      if (sameName) next = { kind: "update", file, hash, target: sameName };
    }

    setPlan(next);
    setCheckingFile(false);
  }

  async function handleQuestions(files: File[]) {
    // add immediately so the UI responds, OCR text fills in async per image
    const placeholders: QuestionImage[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      isBlurry: false,
      ocrText: "",
      status: "pending" as const,
    }));
    setQuestionImages((prev) => [...prev, ...placeholders]);

    placeholders.forEach((item) => runOcr(item.id, item.file));
  }

  // OCR can legitimately return "" (dark/graphic screenshots) or throw (worker
  // failed to load). Track completion explicitly so neither case leaves the
  // Generate button disabled forever.
  async function runOcr(imgId: string, file: File) {
    let isBlurry = false;
    let ocrText = "";
    let status: QuestionImage["status"] = "done";
    try {
      [isBlurry, ocrText] = await Promise.all([
        detectBlur(file),
        extractText(file),
      ]);
    } catch (err) {
      console.error("OCR failed", err);
      status = "error";
    }
    setQuestionImages((prev) =>
      prev.map((img) =>
        img.id === imgId ? { ...img, isBlurry, ocrText, status } : img
      )
    );
  }

  async function replaceImage(imgId: string, file: File) {
    const previewUrl = URL.createObjectURL(file);
    setQuestionImages((prev) =>
      prev.map((img) =>
        img.id === imgId
          ? { ...img, file, previewUrl, status: "pending", ocrText: "" }
          : img
      )
    );
    await runOcr(imgId, file);
  }

  function removeImage(imgId: string) {
    setQuestionImages((prev) => prev.filter((img) => img.id !== imgId));
  }

  function addTextQuestions(texts: string[]) {
    setTextQuestions((prev) => [
      ...prev,
      ...texts.map((text) => ({ id: crypto.randomUUID(), text })),
    ]);
  }

  function removeTextQuestion(qid: string) {
    setTextQuestions((prev) => prev.filter((q) => q.id !== qid));
  }

  const ocrInProgress = questionImages.some((i) => i.status === "pending");
  const unreadableCount = questionImages.filter(
    (i) => i.status !== "pending" && !i.ocrText.trim()
  ).length;
  // saved = fully indexed (or linked to an indexed copy); the rest are
  // half-finished uploads we can still resume instead of duplicating
  const memory = allMaterials.filter((m) => m.indexed_at || m.chunks_from);
  const hasMaterial = plan !== null || memory.length > 0;
  const canGenerate =
    hasMaterial &&
    !checkingFile &&
    (questionImages.length > 0 || textQuestions.length > 0) &&
    !ocrInProgress;
  const blurryCount = questionImages.filter((i) => i.isBlurry).length;

  async function handleGenerate() {
    if (!canGenerate || starting) return;
    setStarting(true);

    // Stash files in sessionStorage-friendly form via IndexedDB-free approach:
    // pass through router state using a short-lived in-memory store on window,
    // since File objects can't survive a hard navigation. The generating page
    // reads from this same client session, so we upload here and let the
    // generating page poll question_set status.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Material: only upload/process what memory doesn't already have
    const fail = (message: string) => {
      setGenError(message);
      setStarting(false);
    };
    let materialId: string | undefined;

    if (plan?.kind === "reuse") {
      materialId = plan.target.id; // already remembered: nothing to upload
    } else if (plan?.kind === "link") {
      // identical file indexed elsewhere: point at its chunks, no upload, no embedding
      const { data: row, error } = await supabase
        .from("materials")
        .insert({
          workspace_id: id,
          file_name: plan.file.name,
          content_hash: plan.hash,
          chunks_from: plan.sourceId,
          indexed_at: new Date().toISOString(),
          storage_path: null,
        })
        .select()
        .single();
      if (error || !row) return fail("Couldn't link your saved material. Please try again.");
      materialId = row.id;
    } else if (plan) {
      const materialPath = `${user.id}/${id}/${plan.file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("materials")
        .upload(materialPath, plan.file, { upsert: true });
      if (uploadError) return fail(`Couldn't upload your material: ${uploadError.message}`);

      if (plan.kind === "update") {
        // same document, new content: keep its memory row, chunk-diff on process
        const { error } = await supabase
          .from("materials")
          .update({
            storage_path: materialPath,
            content_hash: plan.hash,
            indexed_at: null,
            chunks_from: null,
            file_deleted_at: null,
            uploaded_at: new Date().toISOString(),
          })
          .eq("id", plan.target.id);
        if (error) return fail("Couldn't update your saved material. Please try again.");
        materialId = plan.target.id;
      } else {
        const { data: row, error } = await supabase
          .from("materials")
          .insert({
            workspace_id: id,
            file_name: plan.file.name,
            storage_path: materialPath,
            content_hash: plan.hash,
          })
          .select()
          .single();
        if (error || !row) return fail("Couldn't save your material. Please try again.");
        materialId = row.id;
      }
    } else {
      // nothing new picked: use what's already in memory
      materialId = (memory.find((m) => !m.indexed_at && !m.chunks_from) ?? memory[0]).id;
    }

    // 2. Create question set
    const { data: questionSet } = await supabase
      .from("question_sets")
      .insert({ workspace_id: id, status: "pending" })
      .select()
      .single();

    // 3. Upload question screenshots + insert rows
    await Promise.all(
      questionImages.map(async (img, index) => {
        const path = `${user.id}/${id}/${questionSet!.id}/${index}-${img.file.name}`;
        await supabase.storage
          .from("question-screenshots")
          .upload(path, img.file, { upsert: true });
        await supabase.from("questions").insert({
          question_set_id: questionSet!.id,
          image_path: path,
          ocr_text: img.ocrText,
          is_blurry: img.isBlurry,
          source: "image",
          order_index: index,
        });
      })
    );

    // 3b. Pasted text questions: no image, the text goes straight to ocr_text
    // (the field generate-answers reads), ordered after the screenshots
    if (textQuestions.length > 0) {
      await supabase.from("questions").insert(
        textQuestions.map((q, i) => ({
          question_set_id: questionSet!.id,
          image_path: null,
          ocr_text: q.text,
          is_blurry: false,
          source: "text",
          order_index: questionImages.length + i,
        }))
      );
    }

    // 4. Hand off to the generating page. It indexes the material (in as many
    // resumable passes as the free-tier rate limit needs), then starts
    // generate-answers, and shows real progress while it does.
    router.push(
      `/workspace/${id}/generating?set=${questionSet!.id}&material=${materialId}`
    );
  }

  return (
    <main className="min-h-screen bg-cream px-6 py-8 md:px-12">
      <div className="mx-auto max-w-2xl">
        <button
          onClick={() => router.push("/dashboard")}
          className="mb-4 flex items-center gap-2 text-sm text-muted"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <div className="mb-8">
          {subjectTag && (
            <span className="mb-2 inline-block rounded-full bg-wine/10 px-3 py-1 text-xs font-medium text-wine">
              {subjectTag}
            </span>
          )}
          <h1 className="text-2xl font-bold text-ink">{workspaceName}</h1>
        </div>

        {pastSets.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-2 flex items-center gap-2 font-semibold text-wine">
              <History size={16} />
              Previous answers
            </h2>
            <ul className="flex flex-col gap-2">
              {pastSets.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => router.push(`/workspace/${id}/results?set=${r.id}`)}
                    className="flex w-full items-center justify-between rounded-xl bg-white px-4 py-3 text-left shadow-sm transition hover:shadow-md"
                  >
                    <span className="text-sm font-medium text-ink">
                      {new Date(r.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="text-sm text-muted">
                      {r.count} answer{r.count !== 1 ? "s" : ""} · View
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mb-8">
          <h2 className="mb-1 flex items-center gap-2 font-semibold text-wine">
            Study Material
          </h2>
          <p className="mb-3 text-sm text-muted">
            {memory.length > 0 && !plan
              ? "Your material is saved in memory, so there's no need to upload it again."
              : "Upload your notes, textbook, or reference material."}
          </p>

          {checkingFile ? (
            <p className="rounded-xl bg-white px-4 py-3 text-sm text-muted shadow-sm">
              Checking memory…
            </p>
          ) : plan ? (
            <>
              <FileChip
                name={plan.file.name}
                size={`${(plan.file.size / 1024 / 1024).toFixed(1)} MB`}
                onRemove={() => setPlan(null)}
              />
              <p className="mt-2 flex items-start gap-2 text-xs text-muted">
                <DatabaseZap size={14} className="mt-0.5 shrink-0 text-wine" />
                {plan.kind === "reuse" &&
                  "Already in memory. Nothing to upload or process."}
                {plan.kind === "link" &&
                  `Already in memory from "${plan.fromWorkspace}". Reusing it, nothing to process.`}
                {plan.kind === "update" &&
                  "Updated version of a saved file. Only new or changed sections will be processed."}
                {plan.kind === "new" &&
                  "New material. It's processed once, then remembered."}
              </p>
            </>
          ) : memory.length > 0 && !showUpload ? (
            <>
              <ul className="flex flex-col gap-2">
                {memory.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm"
                  >
                    <DatabaseZap size={16} className="shrink-0 text-wine" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{m.file_name}</p>
                      <p className="text-xs text-muted">
                        Saved in memory
                        {m.file_deleted_at ? " · original file removed to save storage" : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setShowUpload(true)}
                className="mt-2 text-xs text-muted underline transition hover:text-wine"
              >
                Upload an updated or different file
              </button>
            </>
          ) : (
            <UploadZone kind="material" onFiles={handleMaterial} />
          )}
        </section>

        <section className="mb-8">
          <h2 className="mb-1 font-semibold text-wine">Questions</h2>
          <p className="mb-3 text-sm text-muted">
            Upload screenshots of your questions, or paste the text.
          </p>

          <UploadZone kind="questions" onFiles={handleQuestions} />

          {questionImages.length > 0 && (
            <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
              {questionImages.map((img) => (
                <QuestionThumb
                  key={img.id}
                  image={img}
                  onRemove={() => removeImage(img.id)}
                  onReplace={(file) => replaceImage(img.id, file)}
                />
              ))}
            </div>
          )}

          <PasteQuestions
            questions={textQuestions}
            onAdd={addTextQuestions}
            onRemove={removeTextQuestion}
          />

          {unreadableCount > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-warn/10 px-4 py-3 text-sm text-ink">
              <AlertTriangle size={16} className="shrink-0 text-warn" />
              {unreadableCount === 1
                ? "Couldn't read text in 1 screenshot. It will be marked unsure; paste its text instead for an answer."
                : `Couldn't read text in ${unreadableCount} screenshots. They will be marked unsure; paste their text instead for answers.`}
            </div>
          )}

          {blurryCount > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-warn/10 px-4 py-3 text-sm text-ink">
              <AlertTriangle size={16} className="shrink-0 text-warn" />
              This looks blurry — retake or re-upload for accurate results.
            </div>
          )}
        </section>

        <button
          onClick={handleGenerate}
          disabled={!canGenerate || starting}
          className={`flex w-full items-center justify-center gap-2 rounded-full bg-wine px-6 py-4 font-medium text-cream transition disabled:opacity-40 ${
            canGenerate && !starting ? "animate-[pulseGlow_2s_infinite]" : ""
          }`}
        >
          <Sparkles size={18} />
          {starting ? "Starting…" : "Generate Answers"}
        </button>
        {genError && (
          <p role="alert" className="mt-3 text-center text-xs text-wine-dark">
            {genError}
          </p>
        )}
        {!canGenerate && !starting && (
          <p className="mt-3 text-center text-xs text-muted">
            {!hasMaterial
              ? "Upload your study material to continue."
              : ocrInProgress
              ? "Reading your screenshots…"
              : "Add at least one question to continue."}
          </p>
        )}
      </div>
    </main>
  );
}
