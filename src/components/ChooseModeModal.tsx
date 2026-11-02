"use client";

import { GraduationCap, MessageSquareText, X } from "lucide-react";

export default function ChooseModeModal({
  onClose,
  onLearn,
  onAnswers,
}: {
  onClose: () => void;
  onLearn: () => void;
  onAnswers: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-cream p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-xl font-bold text-ink">What do you want to do?</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted">
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <button
            onClick={onLearn}
            className="flex items-center gap-4 rounded-xl border border-wine/15 bg-white p-4 text-left shadow-sm transition hover:shadow-md active:scale-[0.99]"
          >
            <GraduationCap size={28} className="shrink-0 text-wine" />
            <span>
              <span className="block font-semibold text-ink">Learn</span>
              <span className="text-sm text-muted">
                Upload course material and be taught it module by module.
              </span>
            </span>
          </button>
          <button
            onClick={onAnswers}
            className="flex items-center gap-4 rounded-xl border border-wine/15 bg-white p-4 text-left shadow-sm transition hover:shadow-md active:scale-[0.99]"
          >
            <MessageSquareText size={28} className="shrink-0 text-wine" />
            <span>
              <span className="block font-semibold text-ink">Answers</span>
              <span className="text-sm text-muted">
                Upload course material and questions, get answers from your notes.
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
