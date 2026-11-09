// Shared Paystack helpers for paystack-verify and paystack-webhook.
//
// Pricing lives here, server-side, on purpose: the client tells Paystack how
// much to charge (so the checkout popup shows the right amount), but the
// amount that actually unlocks premium is whatever this file says the plan
// costs — never what the client or the webhook payload claims. That's what
// stops a tampered metadata.plan from buying lifetime for the price of a
// month.
export const PLAN_PRICES_KOBO = {
  monthly: 150_000, // NGN 1,500/month
  lifetime: 1_500_000, // NGN 15,000 once
} as const;

export type PlanKind = keyof typeof PLAN_PRICES_KOBO;

export function isPlanKind(v: unknown): v is PlanKind {
  return v === "monthly" || v === "lifetime";
}

type PaystackVerifyResponse = {
  status: boolean;
  message: string;
  data: {
    status: string; // "success" | "failed" | "abandoned" | ...
    reference: string;
    amount: number; // kobo
    currency: string;
    customer: { email: string; customer_code: string };
    metadata: Record<string, unknown> | null;
  };
};

export async function verifyPaystackTransaction(
  secretKey: string,
  reference: string
): Promise<PaystackVerifyResponse> {
  const res = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secretKey}` } }
  );
  const body = (await res.json()) as PaystackVerifyResponse;
  if (!res.ok) {
    throw new Error(body.message || `Paystack verify failed (${res.status})`);
  }
  return body;
}

// HMAC-SHA512 of the raw request body, hex-encoded, must equal the
// X-Paystack-Signature header. Confirms the webhook really came from
// Paystack and the body wasn't altered in transit.
export async function verifyPaystackSignature(
  secretKey: string,
  rawBody: string,
  signatureHeader: string | null
): Promise<boolean> {
  if (!signatureHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === signatureHeader;
}

// Upserts the subscription row for a successful, verified charge and logs
// the payment. Shared by paystack-verify (immediate, client-triggered) and
// paystack-webhook (authoritative, in case the client never calls back).
// Idempotent on `reference`: a webhook that arrives after verify already ran
// (or vice versa) is a no-op on the second write.
export async function grantPremium(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: {
    userId: string;
    email: string;
    plan: PlanKind;
    reference: string;
    amountKobo: number;
    customerCode: string | null;
    raw: unknown;
  }
) {
  const { userId, email, plan, reference, amountKobo, customerCode, raw } = args;

  const { data: existingPayment } = await supabase
    .from("payments")
    .select("id, status")
    .eq("reference", reference)
    .maybeSingle();
  if (existingPayment?.status === "success") {
    return { alreadyProcessed: true };
  }

  await supabase.from("payments").upsert(
    {
      user_id: userId,
      reference,
      plan,
      amount_kobo: amountKobo,
      status: "success",
      raw,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "reference" }
  );

  if (plan === "lifetime") {
    await supabase.from("subscriptions").upsert(
      {
        user_id: userId,
        plan: "lifetime",
        status: "active",
        current_period_end: null,
        paystack_customer_code: customerCode,
        paystack_email: email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  } else {
    const { data: existingSub } = await supabase
      .from("subscriptions")
      .select("plan, current_period_end")
      .eq("user_id", userId)
      .maybeSingle();

    const now = new Date();
    const stillActive =
      existingSub?.plan === "monthly" &&
      existingSub.current_period_end &&
      new Date(existingSub.current_period_end) > now;
    const base = stillActive ? new Date(existingSub!.current_period_end as string) : now;
    const nextPeriodEnd = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);

    await supabase.from("subscriptions").upsert(
      {
        user_id: userId,
        plan: "monthly",
        status: "active",
        current_period_end: nextPeriodEnd.toISOString(),
        paystack_customer_code: customerCode,
        paystack_email: email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  }

  return { alreadyProcessed: false };
}
