"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, AlertTriangle, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { detectBlur } from "@/lib/blurDetection";
import { extractText } from "@/lib/ocr";
import UploadZone, { FileChip } from "@/components/UploadZone";
import QuestionThumb from "@/components/QuestionThumb";
import PasteQuestions from "@/components/PasteQuestions";
import { QuestionImage } from "@/lib/types";

// supabase-js hides the edge function's response body inside error.context
// (a fetch Response). Pull the text out so failures are diagnosable.
async function readFunctionError(err: unknown): Promise<string> {
  const ctx = (err as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.text === "function") {
    try {
      return await ctx.text();
    } catch {
      // fall through to the generic message
    }
  }
  return err instanceof Error ? err.message : String(err);
}

export default function WorkspaceClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [workspaceName, setWorkspaceName] = useState("");
  const [subjectTag, setSubjectTag] = useState<string | null>(null);
  const [materialFile, setMaterialFile] = useState<File | null>(null);
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
  }, [id, supabase]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  function handleMaterial(files: File[]) {
    if (files[0]) setMaterialFile(files[0]);
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
  const canGenerate =
    materialFile !== null &&
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

    // 1. Upload material to storage
    const materialPath = `${user.id}/${id}/${materialFile!.name}`;
    await supabase.storage.from("materials").upload(materialPath, materialFile!, {
      upsert: true,
    });
    const { data: materialRow } = await supabase
      .from("materials")
      .insert({
        workspace_id: id,
        file_name: materialFile!.name,
        storage_path: materialPath,
      })
      .select()
      .single();

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

    // 4. Kick off processing (Edge Functions). Material must be indexed
    // before answers can be generated, so these run in order.
    const processed = await supabase.functions.invoke("process-material", {
      body: { materialId: materialRow!.id },
    });
    if (processed.error) {
      // The edge function returns { error: "..." } in the response body; log
      // it so the browser console shows WHY it failed, not just "500".
      console.error(
        "process-material failed:",
        await readFunctionError(processed.error)
      );
      await supabase
        .from("question_sets")
        .update({ status: "error" })
        .eq("id", questionSet!.id);
    } else {
      // don't await: generate-answers can take a while and reports progress
      // through question_sets.status, which the generating page polls
      void supabase.functions.invoke("generate-answers", {
        body: { questionSetId: questionSet!.id },
      });
    }

    router.push(`/workspace/${id}/generating?set=${questionSet!.id}`);
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

        <section className="mb-8">
          <h2 className="mb-1 flex items-center gap-2 font-semibold text-wine">
            Study Material
          </h2>
          <p className="mb-3 text-sm text-muted">
            Upload your notes, textbook, or reference material.
          </p>

          {materialFile ? (
            <FileChip
              name={materialFile.name}
              size={`${(materialFile.size / 1024 / 1024).toFixed(1)} MB`}
              onRemove={() => setMaterialFile(null)}
            />
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
        {!canGenerate && !starting && (
          <p className="mt-3 text-center text-xs text-muted">
            {!materialFile
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
