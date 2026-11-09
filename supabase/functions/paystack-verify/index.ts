// Edge Function: paystack-verify
// Called by the signed-in client right after the Paystack inline checkout
// reports success. Verifies the transaction server-side (never trusts the
// client's word that it succeeded), checks the amount actually paid matches
// what that plan costs, then grants premium and returns the fresh usage
// summary so the UI can update immediately.
//
// The webhook (paystack-webhook) does the same grant independently, so a
// closed tab or a failed network call here doesn't cost the student their
// purchase — this function is just the fast path for instant UI feedback.
//
// Invoke: supabase.functions.invoke("paystack-verify", { body: { reference } })

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { grantPremium, isPlanKind, PLAN_PRICES_KOBO, verifyPaystackTransaction } from "../_shared/paystack.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Not authenticated" }, 401);

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData.user) return jsonResponse({ error: "Not authenticated" }, 401);
    const user = userData.user;

    const { reference } = await req.json();
    if (!reference || typeof reference !== "string") {
      return jsonResponse({ error: "reference is required" }, 400);
    }

    const secretKey = Deno.env.get("PAYSTACK_SECRET_KEY")!;
    const result = await verifyPaystackTransaction(secretKey, reference);

    if (!result.status || result.data.status !== "success") {
      return jsonResponse({ error: "Payment was not successful", status: result.data?.status }, 402);
    }

    const plan = result.data.metadata?.plan;
    if (!isPlanKind(plan)) {
      return jsonResponse({ error: "Could not determine the plan for this payment" }, 400);
    }

    // The amount actually charged must match what this plan costs — the
    // only thing here we don't trust is the client-supplied metadata.
    if (result.data.amount !== PLAN_PRICES_KOBO[plan]) {
      return jsonResponse({ error: "Amount paid does not match the plan price" }, 400);
    }

    // The paying card's email must belong to this signed-in user, so one
    // student can't verify a reference that paid for someone else's plan.
    if (result.data.customer.email.toLowerCase() !== (user.email ?? "").toLowerCase()) {
      return jsonResponse({ error: "This payment does not belong to your account" }, 403);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await grantPremium(supabase, {
      userId: user.id,
      email: user.email ?? "",
      plan,
      reference,
      amountKobo: result.data.amount,
      customerCode: result.data.customer.customer_code ?? null,
      raw: result,
    });

    // get_usage_summary() reads auth.uid(), so it has to run through a
    // client carrying this user's JWT — the service-role client above has
    // no user to read.
    const { data: summary } = await anonClient.rpc("get_usage_summary", {});

    return jsonResponse({ success: true, plan, summary });
  } catch (err) {
    console.error("paystack-verify error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
