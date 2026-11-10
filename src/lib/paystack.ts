import type { SupabaseClient } from "@supabase/supabase-js";
import { readFunctionError } from "@/lib/functionError";
import type { UsageSummary } from "@/lib/usage";

export type PlanKind = "monthly" | "lifetime";

// Mirrors supabase/functions/_shared/paystack.ts — for display only. The
// amount that actually unlocks premium is decided server-side in
// paystack-verify/paystack-webhook, not by whatever runs here.
export const PLAN_PRICES_NGN: Record<PlanKind, number> = {
  monthly: 1_500,
  lifetime: 15_000,
};

export const PLAN_LABELS: Record<PlanKind, string> = {
  monthly: "Monthly",
  lifetime: "Lifetime",
};

declare global {
  interface Window {
    PaystackPop?: {
      setup(options: {
        key: string;
        email: string;
        amount: number; // kobo
        currency?: string;
        ref?: string;
        metadata?: Record<string, unknown>;
        callback: (response: { reference: string }) => void;
        onClose: () => void;
      }): { openIframe: () => void };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadPaystackScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.PaystackPop) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://js.paystack.co/v2/inline.js"]'
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Paystack script failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.paystack.co/v2/inline.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Paystack script failed to load"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export type CheckoutResult =
  | { ok: true; plan: PlanKind; summary: UsageSummary | null }
  | { ok: false; error: string };

// Opens the Paystack inline popup for the given plan, then verifies the
// charge server-side before reporting success — the popup firing its
// success callback is not, by itself, proof of payment.
export async function startPaystackCheckout(
  supabase: SupabaseClient,
  args: { email: string; userId: string; plan: PlanKind }
): Promise<CheckoutResult> {
  const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;
  if (!publicKey) {
    return { ok: false, error: "Payments aren't configured yet." };
  }

  try {
    await loadPaystackScript();
  } catch {
    return { ok: false, error: "Couldn't load the payment popup. Check your connection and try again." };
  }

  if (!window.PaystackPop) {
    return { ok: false, error: "Couldn't load the payment popup. Try again." };
  }

  return new Promise<CheckoutResult>((resolve) => {
    const handle = window.PaystackPop!.setup({
      key: publicKey,
      email: args.email,
      amount: PLAN_PRICES_NGN[args.plan] * 100, // naira -> kobo
      currency: "NGN",
      metadata: { user_id: args.userId, plan: args.plan },
      callback: (response) => {
        verifyAndGrant(supabase, response.reference).then(resolve);
      },
      onClose: () => {
        resolve({ ok: false, error: "closed" });
      },
    });
    handle.openIframe();
  });
}

async function verifyAndGrant(supabase: SupabaseClient, reference: string): Promise<CheckoutResult> {
  const { data, error } = await supabase.functions.invoke("paystack-verify", {
    body: { reference },
  });
  if (error) {
    const message = await readFunctionError(error);
    return { ok: false, error: message || "Couldn't confirm the payment. Please contact support." };
  }
  if (!data?.success) {
    return { ok: false, error: data?.error ?? "Couldn't confirm the payment." };
  }
  return { ok: true, plan: data.plan, summary: toUsageSummary(data.summary) };
}

type SummaryRow = {
  plan: "free" | "monthly" | "lifetime";
  is_premium: boolean;
  period_end: string | null;
  learn_used: number;
  answers_used: number;
  limit: number;
};

function toUsageSummary(row: SummaryRow | null | undefined): UsageSummary | null {
  if (!row) return null;
  return {
    plan: row.plan,
    isPremium: row.is_premium,
    periodEnd: row.period_end,
    learnUsed: row.learn_used,
    answersUsed: row.answers_used,
    limit: row.limit,
  };
}
