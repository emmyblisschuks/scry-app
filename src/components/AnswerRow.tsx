"use client";

import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { Answer } from "@/lib/types";

const CONFIDENCE_LABEL: Record<Answer["confidence"], string> = {
  high: "High confidence",
  low: "Low confidence",
  unsure: "Unsure — check manually",
};

const CONFIDENCE_DOT: Record<Answer["confidence"], string> = {
  high: "bg-ok",
  low: "bg-warn",
  unsure: "bg-transparent border-2 border-orange-500",
};

export default function AnswerRow({ answer }: { answer: Answer }) {
  const [open, setOpen] = useState(false);
  const hasSource = Boolean(answer.source_snippet);

  return (
    <div
      className={`rounded-2xl bg-white shadow-sm ${
        answer.confidence === "unsure" ? "ring-1 ring-orange-300" : ""
      }`}
    >
      <button
        onClick={() => hasSource && setOpen((o) => !o)}
        className="flex w-full items-center gap-4 px-5 py-4 text-left"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wine font-semibold text-cream">
          {answer.order_index}
        </span>
        <span className="flex-1 text-xl font-bold text-ink">
          {answer.answer_text}
        </span>
        <span
          className={`flex items-center gap-1.5 text-xs ${
            answer.confidence === "unsure" ? "text-orange-600" : "text-muted"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${CONFIDENCE_DOT[answer.confidence]}`} />
          {CONFIDENCE_LABEL[answer.confidence]}
        </span>
        {hasSource && (
          <ChevronDown
            size={16}
            className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open && hasSource && (
        <div className="mx-5 mb-4 rounded-xl bg-cream px-4 py-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
            <FileText size={12} />
            Source from study material
          </p>
          <p className="text-sm italic text-ink">“{answer.source_snippet}”</p>
        </div>
      )}
    </div>
  );
}
