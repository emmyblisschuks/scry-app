"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Workspace } from "@/lib/types";
import WorkspaceCard from "@/components/WorkspaceCard";
import CreateWorkspaceModal from "@/components/CreateWorkspaceModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import Logo from "@/components/Logo";
import ProfileMenu, { ProfileUser } from "@/components/ProfileMenu";

export default function DashboardPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Workspace | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      setProfile({
        email: user.email ?? "",
        name:
          (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined) ??
          null,
        avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
      });
    }

    // answers hang off questions, not question_sets, so the embed has to go
    // workspaces -> question_sets -> questions -> answers
    const { data: ws, error: loadError } = await supabase
      .from("workspaces")
      .select("*, question_sets(questions(answers(count)))")
      .order("created_at", { ascending: false });

    if (loadError) {
      setError(`Couldn't load your workspaces: ${loadError.message}`);
      setLoading(false);
      return;
    }

    type Row = {
      id: string;
      user_id: string;
      name: string;
      subject_tag: string | null;
      created_at: string;
      question_sets?: { questions?: { answers?: { count: number }[] }[] }[];
    };

    const mapped: Workspace[] = ((ws ?? []) as Row[]).map((row) => {
      const answerCount =
        row.question_sets?.reduce(
          (sum, qs) =>
            sum +
            (qs.questions?.reduce(
              (qSum, q) => qSum + (q.answers?.[0]?.count ?? 0),
              0
            ) ?? 0),
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

    setError(null);
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
    if (!user) {
      throw new Error("Your session expired. Please sign in again.");
    }

    const { error: insertError } = await supabase.from("workspaces").insert({
      user_id: user.id,
      name,
      subject_tag: subjectTag,
    });
    if (insertError) throw new Error(insertError.message);

    setShowCreate(false);
    await load();
  }

  async function deleteWorkspace() {
    if (!pendingDelete) return;
    const { error: deleteError } = await supabase
      .from("workspaces")
      .delete()
      .eq("id", pendingDelete.id);
    if (deleteError) {
      setError(`Couldn't delete workspace: ${deleteError.message}`);
    }
    setPendingDelete(null);
    await load();
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
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
          {profile && <ProfileMenu user={profile} onSignOut={signOut} />}
        </header>

        <h1 className="mb-6 text-2xl font-bold text-ink">My Workspaces</h1>

        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-wine/20 bg-wine/5 px-4 py-3 text-sm text-wine-dark"
          >
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="font-medium underline"
            >
              Dismiss
            </button>
          </div>
        )}

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
