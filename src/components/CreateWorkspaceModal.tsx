"use client";

import { useState } from "react";
import { X } from "lucide-react";

export default function CreateWorkspaceModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, subjectTag: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setSubmitting(true);
    const subjectTag = guessSubject(name);
    await onCreate(name.trim(), subjectTag);
    setSubmitting(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm animate-[scaleIn_0.15s_ease-out] rounded-2xl bg-cream p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">New workspace</h2>
          <button onClick={onClose} aria-label="Close">
            <X size={18} className="text-muted" />
          </button>
        </div>

        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="e.g. CIT301 or Biology 101"
          className="w-full rounded-xl border border-cream-dark bg-white px-4 py-3 text-sm text-ink outline-none focus:border-wine"
        />

        <button
          onClick={handleCreate}
          disabled={!name.trim() || submitting}
          className="mt-4 w-full rounded-full bg-wine px-6 py-3 font-medium text-cream transition disabled:opacity-40"
        >
          {submitting ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}

function guessSubject(name: string) {
  const lower = name.toLowerCase();
  if (/(math|calc|algebra|cit3)/.test(lower)) return "Mathematics";
  if (/(cs|comput|program|cit)/.test(lower)) return "Computer Science";
  if (/(phy)/.test(lower)) return "Physics";
  if (/(chem)/.test(lower)) return "Chemistry";
  if (/(bio)/.test(lower)) return "Biology";
  if (/(eng|lit)/.test(lower)) return "English";
  return "General";
}
