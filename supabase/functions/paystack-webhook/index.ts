// Edge Function: paystack-webhook
// Paystack calls this directly (no user session) whenever a transaction's
// status changes. This is the authoritative confirmation — it still grants
// premium even if the student closed the tab before paystack-verify ran.
//
// Deployed with verify_jwt = false (it does its own auth: the
// X-Paystack-Signature header, not a Supabase JWT). Register this URL in
// the Paystack dashboard under Settings -> API Keys & Webhooks.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { grantPremium, isPlanKind, PLAN_PRICES_KOBO, verifyPaystackSignature } from "../_shared/paystack.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const secretKey = Deno.env.get("PAYSTACK_SECRET_KEY")!;
  const signature = req.headers.get("x-paystack-signature");

  const valid = await verifyPaystackSignature(secretKey, rawBody, signature);
  if (!valid) {
    console.error("paystack-webhook: bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    const event = JSON.parse(rawBody);

    // We only act on a successful charge; other events (subscription.*,
    // invoice.*) aren't used by this simple one-off-payment setup.
    if (event.event !== "charge.success") {
      return jsonResponse({ received: true, ignored: event.event });
    }

    const data = event.data;
    const plan = data?.metadata?.plan;
    const userId = data?.metadata?.user_id;

    if (!isPlanKind(plan) || typeof userId !== "string") {
      console.error("paystack-webhook: missing/invalid metadata on charge.success", data?.metadata);
      return jsonResponse({ received: true, error: "missing metadata" });
    }
    if (data.status !== "success") {
      return jsonResponse({ received: true, ignored: "not successful" });
    }
    if (data.amount !== PLAN_PRICES_KOBO[plan]) {
      console.error("paystack-webhook: amount mismatch", { plan, amount: data.amount });
      return jsonResponse({ received: true, error: "amount mismatch" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Confirm the user id in metadata is a real user before trusting it.
    const { data: userRow, error: userErr } = await supabase.auth.admin.getUserById(userId);
    if (userErr || !userRow?.user) {
      console.error("paystack-webhook: unknown user_id in metadata", userId);
      return jsonResponse({ received: true, error: "unknown user" });
    }

    await grantPremium(supabase, {
      userId,
      email: userRow.user.email ?? data.customer?.email ?? "",
      plan,
      reference: data.reference,
      amountKobo: data.amount,
      customerCode: data.customer?.customer_code ?? null,
      raw: event,
    });

    return jsonResponse({ received: true });
  } catch (err) {
    console.error("paystack-webhook error:", err);
    // Still 200 — Paystack retries on non-2xx, and a malformed/unexpected
    // payload won't fix itself on retry.
    return jsonResponse({ received: true, error: String(err) });
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
