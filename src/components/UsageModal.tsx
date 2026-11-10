"use client";

import { useState } from "react";
import { X, Sparkles, Crown, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { UsageSummary, planLabel } from "@/lib/usage";
import { PLAN_PRICES_NGN, PlanKind, startPaystackCheckout } from "@/lib/paystack";

export default function UsageModal({
  email,
  userId,
  summary,
  onClose,
  onUpgraded,
  reason,
}: {
  email: string;
  userId: string;
  summary: UsageSummary;
  onClose: () => void;
  onUpgraded: (summary: UsageSummary) => void;
  // when opened because a free-tier limit was hit, say which one
  reason?: "learn" | "answers" | null;
}) {
  const [supabase] = useState(() => createClient());
  const [paying, setPaying] = useState<PlanKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upgrade(plan: PlanKind) {
    setError(null);
    setPaying(plan);
    const result = await startPaystackCheckout(supabase, { email, userId, plan });
    setPaying(null);
    if (!result.ok) {
      if (result.error !== "closed") setError(result.error);
      return;
    }
    if (result.summary) onUpgraded(result.summary);
  }

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
          <h2 className="text-xl font-bold text-ink">Usage &amp; plan</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted">
            <X size={18} />
          </button>
        </div>

        {reason && !summary.isPremium && (
          <div className="mb-4 rounded-xl border border-wine/20 bg-wine/5 px-4 py-3 text-sm text-wine-dark">
            You&apos;ve used all {summary.limit} free {reason === "learn" ? "Learn courses" : "Answers runs"}{" "}
            this month. Upgrade below to keep going.
          </div>
        )}

        <div className="mb-5 rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              {summary.isPremium ? <Crown size={15} className="text-wine" /> : null}
              {planLabel(summary.plan)}
            </span>
            {summary.plan === "monthly" && summary.periodEnd && (
              <span className="text-xs text-muted">
                Renews {new Date(summary.periodEnd).toLocaleDateString()}
              </span>
            )}
          </div>

          <UsageBar
            label="Learn courses"
            used={summary.learnUsed}
            limit={summary.limit}
            unlimited={summary.isPremium}
          />
          <div className="h-3" />
          <UsageBar
            label="Answers runs"
            used={summary.answersUsed}
            limit={summary.limit}
            unlimited={summary.isPremium}
          />
          <p className="mt-3 text-xs text-muted">Resets on the 1st of each month.</p>
        </div>

        {error && (
          <p role="alert" className="mb-3 text-xs text-wine-dark">
            {error}
          </p>
        )}

        {summary.plan === "lifetime" ? (
          <p className="rounded-xl bg-wine/10 px-4 py-3 text-center text-sm font-medium text-wine-dark">
            You have Scry Premium for life. Thank you! 🎉
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <PlanButton
              plan="monthly"
              title="Premium — Monthly"
              hint={summary.plan === "monthly" ? "Extends your current period by 30 days" : "Billed every 30 days"}
              loading={paying === "monthly"}
              disabled={paying !== null}
              onClick={() => upgrade("monthly")}
            />
            <PlanButton
              plan="lifetime"
              title="Premium — Lifetime"
              hint="Pay once, unlimited forever"
              loading={paying === "lifetime"}
              disabled={paying !== null}
              onClick={() => upgrade("lifetime")}
              highlight
            />
          </div>
        )}
      </div>
    </div>
  );
}

function UsageBar({
  label,
  used,
  limit,
  unlimited,
}: {
  label: string;
  used: number;
  limit: number;
  unlimited: boolean;
}) {
  const pct = unlimited ? 100 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-muted">{unlimited ? "Unlimited" : `${used} / ${limit}`}</span>
      </div>
      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-wine/10">
        <span
          className={`block h-full rounded-full ${unlimited ? "bg-wine/40" : "bg-wine"}`}
          style={{ width: `${Math.max(pct, 4)}%` }}
        />
      </span>
    </div>
  );
}

function PlanButton({
  plan,
  title,
  hint,
  loading,
  disabled,
  onClick,
  highlight,
}: {
  plan: PlanKind;
  title: string;
  hint: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-between gap-3 rounded-xl border p-4 text-left transition active:scale-[0.99] disabled:opacity-60 ${
        highlight ? "border-wine bg-wine/10" : "border-wine/15 bg-white"
      }`}
    >
      <span>
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          {highlight && <Sparkles size={14} className="text-wine" />}
          {title}
        </span>
        <span className="text-xs text-muted">{hint}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-bold text-wine">
          ₦{PLAN_PRICES_NGN[plan].toLocaleString()}
        </span>
        <span className="block text-[11px] text-muted">
          {loading ? "Opening…" : plan === "monthly" ? "/month" : "once"}
        </span>
      </span>
    </button>
  );
}

export function PremiumBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-wine/10 px-2 py-0.5 text-[11px] font-medium text-wine">
      <Check size={11} /> Premium
    </span>
  );
}
