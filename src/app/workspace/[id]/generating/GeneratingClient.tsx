"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/components/Logo";
import { readFunctionError } from "@/lib/functionError";

const STAGES = [
  "Reading study material…",
  "Scanning questions…",
  "Matching answers…",
  "Almost done…",
];

export default function GeneratingClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const setId = searchParams.get("set");
  const materialId = searchParams.get("material");
  const supabase = createClient();

  const [progress, setProgress] = useState(8);
  const [stage, setStage] = useState(0);
  const [failed, setFailed] = useState(false);
  // true while process-material is still indexing; the fake "smooth" progress
  // below pauses so the bar can show real indexing progress instead.
  const indexingRef = useRef(false);
  const startedRef = useRef(false);

  // Index the material (resumable, paced to the Gemini free-tier limit), then
  // kick off answer generation. process-material returns done:false until the
  // whole file is indexed, so we keep calling it.
  useEffect(() => {
    if (!setId || !materialId || startedRef.current) return;
    startedRef.current = true;
    indexingRef.current = true;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    (async () => {
      try {
        let done = false;
        let errors = 0;
        for (let pass = 0; !done && pass < 60; pass++) {
          const { data, error } = await supabase.functions.invoke(
            "process-material",
            { body: { materialId } }
          );
          if (error) {
            console.error("process-material failed:", await readFunctionError(error));
            // safe to retry: already-stored chunks are skipped server-side
            if (++errors >= 3) throw error;
            await sleep(5000);
            continue;
          }
          errors = 0;
          if (data?.total > 0) {
            const pct = (data.processed / data.total) * 100;
            setProgress((p) => Math.max(p, 8 + pct * 0.7));
          }
          done = data?.done === true;
          if (!done && data?.rateLimited) await sleep(20000);
        }
        if (!done) throw new Error("Indexing did not finish");

        indexingRef.current = false;
        setProgress((p) => Math.max(p, 80));
        const gen = await supabase.functions.invoke("generate-answers", {
          body: { questionSetId: setId },
        });
        if (gen.error) {
          console.error("generate-answers failed:", await readFunctionError(gen.error));
        }
      } catch (err) {
        console.error(err);
        await supabase
          .from("question_sets")
          .update({ status: "error" })
          .eq("id", setId);
        setFailed(true);
      }
    })();
  }, [setId, materialId, supabase]);

  useEffect(() => {
    if (!setId) return;

    const poll = setInterval(async () => {
      const { data } = await supabase
        .from("question_sets")
        .select("status")
        .eq("id", setId)
        .single();

      if (data?.status === "error") {
        clearInterval(poll);
        setFailed(true);
      } else if (data?.status === "done") {
        setProgress(100);
        clearInterval(poll);
        setTimeout(() => {
          router.push(`/workspace/${id}/results?set=${setId}`);
        }, 600);
      } else if (!indexingRef.current) {
        // smooth fake progress while waiting on real status
        setProgress((p) => Math.min(92, p + Math.random() * 3));
      }
    }, 1200);

    return () => clearInterval(poll);
  }, [id, setId, router, supabase]);

  useEffect(() => {
    const stageIndex = Math.min(
      STAGES.length - 1,
      Math.floor((progress / 100) * STAGES.length)
    );
    setStage(stageIndex);
  }, [progress]);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-cream via-[#F3DCE1] to-cream px-6">
      <div className="z-10 flex flex-col items-center gap-2">
        <Logo size={44} />
        <h1 className="font-serif text-2xl font-bold text-wine">Scry</h1>
        <p className="text-sm text-muted">Better notes. Clearer answers.</p>
      </div>

      {failed ? (
        <div className="z-10 my-12 flex max-w-sm flex-col items-center gap-4 text-center">
          <p className="text-lg font-semibold text-wine">
            Something went wrong generating your answers.
          </p>
          <p className="text-sm text-muted">
            Your files are saved. Go back and try again in a moment.
          </p>
          <button
            onClick={() => router.push(`/workspace/${id}`)}
            className="rounded-full bg-wine px-6 py-3 text-sm font-medium text-cream"
          >
            Back to workspace
          </button>
        </div>
      ) : (
      <>
      <div className="relative z-10 my-12 flex h-56 w-56 items-center justify-center">
        <svg className="absolute h-full w-full -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="#F3DCE1"
            strokeWidth="6"
          />
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="#7A2E3A"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 44}
            strokeDashoffset={2 * Math.PI * 44 * (1 - progress / 100)}
            className="transition-all duration-500 ease-out"
          />
        </svg>
        <span className="text-5xl font-bold text-wine">
          {Math.round(progress)}%
        </span>
      </div>

      <div className="z-10 flex flex-col items-center gap-2">
        {STAGES.map((label, i) => (
          <p
            key={label}
            className={`text-sm transition-opacity duration-300 ${
              i === stage ? "font-medium text-wine opacity-100" : "text-muted opacity-40"
            }`}
          >
            {label}
          </p>
        ))}
      </div>
      </>
      )}
    </main>
  );
}
