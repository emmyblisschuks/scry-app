"use client";

import { useState } from "react";
import { X, Trash2 } from "lucide-react";

export default function DeleteConfirmModal({
  itemName,
  onClose,
  onConfirm,
}: {
  itemName: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [shake, setShake] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    await onConfirm();
    setDeleting(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
      onClick={() => {
        setShake(true);
        setTimeout(() => setShake(false), 300);
      }}
    >
      <div
        className={`w-full max-w-sm rounded-2xl bg-cream p-6 shadow-xl ${
          shake ? "animate-[shake_0.3s_ease-in-out]" : ""
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-wine/10 text-wine">
            <Trash2 size={18} />
          </div>
          <button onClick={onClose} aria-label="Close">
            <X size={18} className="text-muted" />
          </button>
        </div>

        <h2 className="text-lg font-semibold text-ink">Delete this workspace?</h2>
        <p className="mt-1 text-sm text-muted">
          This removes the course material, questions, and answers inside{" "}
          <span className="font-medium text-ink">“{itemName}”</span>. This
          can&apos;t be undone.
        </p>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-full border border-cream-dark px-5 py-2.5 text-sm font-medium text-wine"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex-1 rounded-full bg-wine-dark px-5 py-2.5 text-sm font-medium text-cream disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
