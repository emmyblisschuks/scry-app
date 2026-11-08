"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, GraduationCap, MessageSquareText, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/components/Logo";
import ProfileMenu, { ProfileUser } from "@/components/ProfileMenu";
import { greetingFor } from "@/lib/greeting";
import ChooseModeModal from "@/components/ChooseModeModal";
import {
  LearnCourse,
  loadLearnCourses,
  learnHref,
  whereYouStopped,
} from "@/lib/learnCourses";

type AnswerSpace = { id: string; name: string; answers: number };

export default function DashboardPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [courses, setCourses] = useState<LearnCourse[]>([]);
  const [spaces, setSpaces] = useState<AnswerSpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [showChoose, setShowChoose] = useState(false);
  // Set after mount so it uses the browser's clock (and avoids a
  // server/client mismatch); refreshed every minute.
  const [greeting, setGreeting] = useState("Welcome");
  useEffect(() => {
    const tick = () => setGreeting(greetingFor());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    // getSession() reads the already-validated JWT from local storage (no
    // network call); proxy.ts already re-checked it server-side for this
    // request, so this is purely for the display name/avatar.
    const [{ data: { session } }, learn, ws] = await Promise.all([
      supabase.auth.getSession(),
      loadLearnCourses(supabase),
      supabase
        .from("workspaces")
        .select("id, name, question_sets(questions(answers(count)))")
        .eq("kind", "answers")
        .order("created_at", { ascending: false }),
    ]);
    const user = session?.user;
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

    type Row = {
      id: string;
      name: string;
      question_sets?: { questions?: { answers?: { count: number }[] }[] }[];
    };
    setSpaces(
      ((ws.data ?? []) as Row[]).map((r) => ({
        id: r.id,
        name: r.name,
        answers:
          r.question_sets?.reduce(
            (n, qs) =>
              n + (qs.questions?.reduce((m, q) => m + (q.answers?.[0]?.count ?? 0), 0) ?? 0),
            0
          ) ?? 0,
      }))
    );
    setCourses(learn);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  const resume = courses.find((c) => c.currentUnit > 0);
  const totalAnswers = spaces.reduce((n, s) => n + s.answers, 0);

  return (
    <main className="min-h-screen bg-cream px-6 py-8 md:px-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size={32} />
            <span className="font-serif text-xl font-bold text-wine">Scry</span>
          </div>
          {profile && <ProfileMenu user={profile} onSignOut={signOut} />}
        </header>

        <h1 className="mb-1 text-2xl font-bold text-ink">
          {profile?.name ? `${greeting}, ${profile.name.trim().split(/\s+/)[0]}` : greeting}
        </h1>
        <p className="mb-6 text-sm text-muted">What are you doing today?</p>

        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            {resume ? (
              <button
                onClick={() => router.push(learnHref(resume))}
                className="mb-6 w-full rounded-2xl bg-wine p-5 text-left text-cream shadow-md transition active:scale-[0.99]"
              >
                <span className="block text-xs font-medium uppercase tracking-wide opacity-80">
                  Continue learning
                </span>
                <span className="mt-1 flex items-center justify-between gap-4">
                  <span className="min-w-0">
                    <span className="block truncate text-lg font-semibold">{resume.name}</span>
                    <span className="text-sm opacity-80">{whereYouStopped(resume)}</span>
                  </span>
                  <ArrowRight size={20} className="shrink-0" />
                </span>
                <ProgressBar percent={resume.percent} light />
              </button>
            ) : (
              <button
                onClick={() => setShowChoose(true)}
                className="mb-6 flex w-full items-center justify-between gap-4 rounded-2xl border border-dashed border-wine/30 bg-white p-5 text-left transition active:scale-[0.99]"
              >
                <span>
                  <span className="block font-semibold text-ink">Start something new</span>
                  <span className="text-sm text-muted">
                    Learn a course or get answers to questions.
                  </span>
                </span>
                <ArrowRight size={20} className="shrink-0 text-wine" />
              </button>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Learn lane */}
              <Lane
                icon={<GraduationCap size={18} />}
                title="Learn"
                subtitle={`${courses.length} ${courses.length === 1 ? "course" : "courses"}`}
                onOpen={() => router.push("/learn")}
                emptyText="No courses yet. Upload course material to start learning."
                empty={courses.length === 0}
              >
                {courses.slice(0, 3).map((c) => (
                  <button
                    key={c.materialId}
                    onClick={() => router.push(learnHref(c))}
                    className="w-full rounded-lg bg-cream px-3 py-2.5 text-left transition hover:bg-cream-dark"
                  >
                    <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                    <span className="text-xs text-muted">{whereYouStopped(c)}</span>
                    <ProgressBar percent={c.percent} />
                  </button>
                ))}
              </Lane>

              {/* Answers lane */}
              <Lane
                icon={<MessageSquareText size={18} />}
                title="Answers"
                subtitle={`${spaces.length} ${spaces.length === 1 ? "workspace" : "workspaces"} · ${totalAnswers} answers`}
                onOpen={() => router.push("/answers")}
                emptyText="No workspaces yet. Create one to get answers from your notes."
                empty={spaces.length === 0}
              >
                {spaces.slice(0, 3).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => router.push(`/workspace/${s.id}`)}
                    className="w-full rounded-lg bg-cream px-3 py-2.5 text-left transition hover:bg-cream-dark"
                  >
                    <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
                    <span className="text-xs text-muted">{s.answers} answers</span>
                  </button>
                ))}
              </Lane>
            </div>
          </>
        )}

        <button
          onClick={() => setShowChoose(true)}
          aria-label="Start something new"
          className="fixed bottom-8 right-8 flex h-14 w-14 items-center justify-center rounded-full bg-wine text-cream shadow-lg transition active:scale-90"
        >
          <Plus size={24} />
        </button>
      </div>

      {showChoose && (
        <ChooseModeModal
          onClose={() => setShowChoose(false)}
          onLearn={() => router.push("/learn")}
          onAnswers={() => router.push("/answers")}
        />
      )}
    </main>
  );
}

function Lane({
  icon,
  title,
  subtitle,
  onOpen,
  empty,
  emptyText,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onOpen: () => void;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <button onClick={onOpen} className="mb-3 flex w-full items-center justify-between text-left">
        <span>
          <span className="flex items-center gap-2 text-lg font-bold text-ink">
            <span className="text-wine">{icon}</span> {title}
          </span>
          <span className="text-xs text-muted">{subtitle}</span>
        </span>
        <span className="flex items-center gap-1 text-xs font-medium text-wine">
          Open <ArrowRight size={14} />
        </span>
      </button>
      {empty ? <p className="text-sm text-muted">{emptyText}</p> : <div className="flex flex-col gap-2">{children}</div>}
    </section>
  );
}

function ProgressBar({ percent, light }: { percent: number; light?: boolean }) {
  return (
    <span
      className={`mt-2 block h-1.5 w-full overflow-hidden rounded-full ${
        light ? "bg-cream/25" : "bg-wine/10"
      }`}
    >
      <span
        className={`block h-full rounded-full ${light ? "bg-cream" : "bg-wine"}`}
        style={{ width: `${Math.max(percent, 3)}%` }}
      />
    </span>
  );
}
