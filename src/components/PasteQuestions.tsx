"use client";

import { useState } from "react";
import { ClipboardPaste, X } from "lucide-react";
import { parseQuestions } from "@/lib/parseQuestions";

export const MAX_TEXT_QUESTION_LENGTH = 4000;

export default function PasteQuestions({
  questions,
  onAdd,
  onRemove,
}: {
  questions: { id: string; text: string }[];
  onAdd: (texts: string[]) => void;
  onRemove: (id: string) => void;
}) {
  const [value, setValue] = useState("");
  const parsed = parseQuestions(value);
  const tooLong = parsed.some((q) => q.length > MAX_TEXT_QUESTION_LENGTH);

  function add() {
    if (parsed.length === 0 || tooLong) return;
    onAdd(parsed);
    setValue("");
  }

  return (
    <div className="mt-4">
      <label
        htmlFor="paste-questions"
        className="mb-1 flex items-center gap-2 text-sm font-medium text-wine"
      >
        <ClipboardPaste size={16} />
        Or paste question text
      </label>
      <textarea
        id="paste-questions"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") add();
        }}
        rows={4}
        placeholder={"Paste one question, or several numbered ones:\n1. What is the derivative of x²?\n2. Evaluate ∫ 2x dx"}
        className="w-full resize-y rounded-xl border border-cream-dark bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-wine focus:ring-2 focus:ring-wine/15"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-muted">
          {tooLong
            ? `Each question must be under ${MAX_TEXT_QUESTION_LENGTH} characters.`
            : parsed.length > 1
            ? `Detected ${parsed.length} questions`
            : "Tip: Ctrl/⌘ + Enter to add"}
        </span>
        <button
          type="button"
          onClick={add}
          disabled={parsed.length === 0 || tooLong}
          className="rounded-full border border-wine px-4 py-1.5 text-sm font-medium text-wine transition hover:bg-wine hover:text-cream disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-wine"
        >
          Add {parsed.length > 1 ? `${parsed.length} questions` : "question"}
        </button>
      </div>

      {questions.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {questions.map((q) => (
            <li
              key={q.id}
              className="flex items-start gap-3 rounded-xl border border-wine/10 bg-white px-4 py-3"
            >
              <p className="line-clamp-3 flex-1 whitespace-pre-wrap text-sm text-ink">
                {q.text}
              </p>
              <button
                onClick={() => onRemove(q.id)}
                aria-label="Remove question"
                className="mt-0.5 text-muted transition hover:text-wine"
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
