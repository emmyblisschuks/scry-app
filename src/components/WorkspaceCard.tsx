"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Workspace } from "@/lib/types";
import { colorForSubject } from "@/lib/subjectColors";

export default function WorkspaceCard({
  workspace,
  onDelete,
}: {
  workspace: Workspace;
  onDelete: () => void;
}) {
  const color = colorForSubject(workspace.subject_tag);
  const hasAnswers = (workspace.answer_count ?? 0) > 0;

  return (
    <div className="group relative rounded-2xl border border-wine/10 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <button
        onClick={(e) => {
          e.preventDefault();
          onDelete();
        }}
        aria-label={`Delete ${workspace.name}`}
        className="absolute right-4 top-4 text-wine opacity-0 transition group-hover:opacity-100"
      >
        <Trash2 size={16} />
      </button>

      <Link
        // finished answers open straight away; "Back to Workspace" there leads
        // to the upload screen for adding more questions
        href={
          workspace.latest_set_id
            ? `/workspace/${workspace.id}/results?set=${workspace.latest_set_id}`
            : `/workspace/${workspace.id}`
        }
        className="block"
      >
        {workspace.subject_tag && (
          <span
            className="inline-block rounded-full px-3 py-1 text-xs font-medium"
            style={{ backgroundColor: color.bg, color: color.text }}
          >
            {workspace.subject_tag}
          </span>
        )}
        <h3 className="mt-3 text-xl font-semibold text-ink">
          {workspace.name}
        </h3>
        <div className="mt-2 flex items-center gap-1.5 text-sm text-muted">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              hasAnswers ? "bg-ok" : "bg-muted/40"
            }`}
          />
          {hasAnswers
            ? `${workspace.answer_count} answers ready`
            : "Empty"}
        </div>
      </Link>
    </div>
  );
}
