import type { SupabaseClient } from "@supabase/supabase-js";

export type UsageKind = "learn" | "answers";

export type UsageSummary = {
  plan: "free" | "monthly" | "lifetime";
  isPremium: boolean;
  periodEnd: string | null;
  learnUsed: number;
  answersUsed: number;
  limit: number;
};

type SummaryRow = {
  plan: "free" | "monthly" | "lifetime";
  is_premium: boolean;
  period_end: string | null;
  learn_used: number;
  answers_used: number;
  limit: number;
};

export async function loadUsageSummary(
  supabase: SupabaseClient
): Promise<UsageSummary | null> {
  const { data, error } = await supabase.rpc("get_usage_summary", {});
  if (error || !data) {
    console.error("loadUsageSummary failed", error);
    return null;
  }
  const row = data as SummaryRow;
  return {
    plan: row.plan,
    isPremium: row.is_premium,
    periodEnd: row.period_end,
    learnUsed: row.learn_used,
    answersUsed: row.answers_used,
    limit: row.limit,
  };
}

export type UsageCheck = {
  allowed: boolean;
  used: number;
  limit: number;
  premium: boolean;
};

// Call before starting a new Learn course upload or a new Answers run.
// Atomic on the server: either the use is under the limit and gets recorded,
// or it's refused — never both checked-and-recorded as two separate steps
// that a slow network could split.
export async function checkAndRecordUsage(
  supabase: SupabaseClient,
  kind: UsageKind,
  refId?: string
): Promise<UsageCheck> {
  const { data, error } = await supabase.rpc("check_and_record_usage", {
    p_kind: kind,
    p_ref_id: refId ?? null,
  });
  if (error || !data) {
    console.error("checkAndRecordUsage failed", error);
    // Fail open on an infra error — a glitch in the usage RPC shouldn't
    // block a student from studying. The free-tier limit is a product
    // nudge, not a hard paywall underneath it.
    return { allowed: true, used: 0, limit: 5, premium: false };
  }
  return data as UsageCheck;
}

export function planLabel(plan: UsageSummary["plan"]): string {
  if (plan === "lifetime") return "Premium (lifetime)";
  if (plan === "monthly") return "Premium";
  return "Free";
}
