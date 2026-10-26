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
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name.trim(), guessSubject(name));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSubmitting(false);
    }
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
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter") handleCreate();
          }}
          placeholder="e.g. CIT301 or Biology 101"
          className="w-full rounded-xl border border-cream-dark bg-white px-4 py-3 text-sm text-ink outline-none focus:border-wine"
        />

        {error && (
          <p role="alert" className="mt-3 text-xs text-wine-dark">
            {error}
          </p>
        )}

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
  if (/(phy|mechanic)/.test(lower)) return "Physics";
  if (/(chem)/.test(lower)) return "Chemistry";
  if (/(bio|genetic)/.test(lower)) return "Biology";
  if (/(math|calc|algebra|stat|geometry)/.test(lower)) return "Mathematics";
  if (/(\bcs|\bcit|\bcsc|comput|program|data struct|software)/.test(lower))
    return "Computer Science";
  if (/(\beng|liter|\blit\b|grammar)/.test(lower)) return "English";
  return "General";
}
