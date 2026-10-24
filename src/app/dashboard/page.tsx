"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Workspace } from "@/lib/types";
import WorkspaceCard from "@/components/WorkspaceCard";
import CreateWorkspaceModal from "@/components/CreateWorkspaceModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import Logo from "@/components/Logo";

export default function DashboardPage() {
  const supabase = createClient();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Workspace | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setAvatarUrl(user?.user_metadata?.avatar_url ?? null);

    const { data: ws } = await supabase
      .from("workspaces")
      .select("*, question_sets(answers:answers(count))")
      .order("created_at", { ascending: false });

    const mapped: Workspace[] = (ws ?? []).map((w) => {
      type Row = {
        id: string;
        user_id: string;
        name: string;
        subject_tag: string | null;
        created_at: string;
        question_sets?: { answers?: { count: number }[] }[];
      };
      const row = w as Row;
      const answerCount =
        row.question_sets?.reduce(
          (sum, qs) => sum + (qs.answers?.[0]?.count ?? 0),
          0
        ) ?? 0;
      return {
        id: row.id,
        user_id: row.user_id,
        name: row.name,
        subject_tag: row.subject_tag,
        created_at: row.created_at,
        answer_count: answerCount,
      };
    });

    setWorkspaces(mapped);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function createWorkspace(name: string, subjectTag: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("workspaces").insert({
      user_id: user.id,
      name,
      subject_tag: subjectTag,
    });
    setShowCreate(false);
    load();
  }

  async function deleteWorkspace() {
    if (!pendingDelete) return;
    await supabase.from("workspaces").delete().eq("id", pendingDelete.id);
    setPendingDelete(null);
    load();
  }

  return (
    <main className="min-h-screen bg-cream px-6 py-8 md:px-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size={32} />
            <span className="font-serif text-xl font-bold text-wine">
              Scry
            </span>
          </div>
          {avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt="Profile"
              className="h-9 w-9 rounded-full"
            />
          )}
        </header>

        <h1 className="mb-6 text-2xl font-bold text-ink">My Workspaces</h1>

        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : workspaces.length === 0 ? (
          <EmptyState onCreate={() => setShowCreate(true)} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((w) => (
              <WorkspaceCard
                key={w.id}
                workspace={w}
                onDelete={() => setPendingDelete(w)}
              />
            ))}
          </div>
        )}

        <button
          onClick={() => setShowCreate(true)}
          aria-label="New workspace"
          className="fixed bottom-8 right-8 flex h-14 w-14 items-center justify-center rounded-full bg-wine text-cream shadow-lg transition active:scale-90"
        >
          <Plus size={24} />
        </button>
      </div>

      {showCreate && (
        <CreateWorkspaceModal
          onClose={() => setShowCreate(false)}
          onCreate={createWorkspace}
        />
      )}

      {pendingDelete && (
        <DeleteConfirmModal
          itemName={pendingDelete.name}
          onClose={() => setPendingDelete(null)}
          onConfirm={deleteWorkspace}
        />
      )}
    </main>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-wine/20 py-20 text-center">
      <Sparkles className="text-wine" size={32} />
      <div>
        <p className="font-medium text-ink">Create your first workspace</p>
        <p className="text-sm text-muted">
          Add a subject and start building your knowledge base.
        </p>
      </div>
      <button
        onClick={onCreate}
        className="rounded-full bg-wine px-6 py-2.5 text-sm font-medium text-cream"
      >
        Create workspace
      </button>
    </div>
  );
}
