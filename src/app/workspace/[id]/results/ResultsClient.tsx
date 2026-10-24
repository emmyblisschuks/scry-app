"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Copy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Answer } from "@/lib/types";
import AnswerRow from "@/components/AnswerRow";

export default function ResultsClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const setId = searchParams.get("set");
  const supabase = createClient();

  const [workspaceName, setWorkspaceName] = useState("");
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const { data: ws } = await supabase
      .from("workspaces")
      .select("name")
      .eq("id", id)
      .single();
    if (ws) setWorkspaceName(ws.name);

    if (!setId) return;

    const { data } = await supabase
      .from("questions")
      .select("id, order_index, answers(answer_text, confidence, source_snippet)")
      .eq("question_set_id", setId)
      .order("order_index");

    type Row = {
      id: string;
      order_index: number;
      answers: {
        answer_text: string;
        confidence: Answer["confidence"];
        source_snippet: string | null;
      }[];
    };

    const mapped: Answer[] = ((data as Row[]) ?? [])
      .filter((q) => q.answers?.[0])
      .map((q) => ({
        id: q.id,
        question_id: q.id,
        order_index: q.order_index + 1,
        answer_text: q.answers[0].answer_text,
        confidence: q.answers[0].confidence,
        source_snippet: q.answers[0].source_snippet,
      }));

    setAnswers(mapped);
  }, [id, setId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  function copyAll() {
    const text = answers
      .map((a) => `${a.order_index}. ${a.answer_text}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="min-h-screen bg-cream px-6 py-8 md:px-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink">{workspaceName}</h1>
            <p className="text-sm text-muted">
              {answers.length} question{answers.length !== 1 ? "s" : ""} ·{" "}
              {answers.length} answer{answers.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <div className="mb-6 flex gap-3">
          <button
            onClick={copyAll}
            className="flex items-center gap-2 rounded-full border border-wine/30 px-4 py-2 text-sm font-medium text-wine"
          >
            <Copy size={14} />
            {copied ? "Copied!" : "Copy All"}
          </button>
          <button
            onClick={() => router.push(`/workspace/${id}`)}
            className="flex items-center gap-2 rounded-full border border-wine/30 px-4 py-2 text-sm font-medium text-wine"
          >
            <ArrowLeft size={14} />
            Back to Workspace
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {answers.map((a) => (
            <AnswerRow key={a.id} answer={a} />
          ))}
        </div>
      </div>
    </main>
  );
}
