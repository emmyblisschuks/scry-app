"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut, Crown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadUsageSummary, UsageSummary } from "@/lib/usage";
import UsageModal from "@/components/UsageModal";

export type ProfileUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

export default function ProfileMenu({
  user,
  onSignOut,
}: {
  user: ProfileUser;
  onSignOut: () => Promise<void> | void;
}) {
  const [supabase] = useState(() => createClient());
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  async function openUsage() {
    setOpen(false);
    setShowUsage(true);
    const s = await loadUsageSummary(supabase);
    if (s) setSummary(s);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = user.name || user.email;
  const initial = (label || "?").trim().charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Open profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-wine text-sm font-semibold text-cream ring-2 ring-transparent transition hover:ring-wine/30 focus-visible:ring-wine"
      >
        {user.avatarUrl && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 animate-[scaleIn_0.12s_ease-out] origin-top-right rounded-2xl border border-wine/10 bg-white p-2 shadow-xl"
        >
          <div className="px-3 py-2">
            {user.name && (
              <p className="truncate text-sm font-semibold text-ink">
                {user.name}
              </p>
            )}
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-cream-dark" />
          <button
            role="menuitem"
            onClick={openUsage}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink transition hover:bg-wine/5"
          >
            <Crown size={16} className="text-wine" />
            Usage &amp; plan
          </button>
          <div className="my-1 h-px bg-cream-dark" />
          <button
            role="menuitem"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await onSignOut();
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-wine transition hover:bg-wine/5 disabled:opacity-50"
          >
            <LogOut size={16} />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}

      {showUsage && (
        summary ? (
          <UsageModal
            email={user.email}
            userId={user.id}
            summary={summary}
            onClose={() => setShowUsage(false)}
            onUpgraded={(s) => setSummary(s)}
          />
        ) : (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
            onClick={() => setShowUsage(false)}
          >
            <div className="rounded-2xl bg-cream px-6 py-5 text-sm text-muted shadow-xl">
              Loading…
            </div>
          </div>
        )
      )}
    </div>
  );
}
