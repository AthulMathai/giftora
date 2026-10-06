import { after, NextResponse } from "next/server";
import type Stripe from "stripe";
import { processOutbox } from "@/lib/notify";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe → Giftora. The ONLY place an order becomes paid.
 * Signature-verified, idempotent (event ids are stored), and safe to retry: we return 500 on
 * failure so Stripe redelivers.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) return NextResponse.json({ error: "not configured" }, { status: 400 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: isNew, error: recErr } = await admin.rpc("svc_record_payment_event", {
    p_event_id: event.id, p_type: event.type, p_payload: event as unknown as Record<string, unknown>,
  });
  if (recErr) return NextResponse.json({ error: "store failed" }, { status: 500 });
  if (!isNew) return NextResponse.json({ received: true, duplicate: true });

  try {
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const orderId = pi.metadata?.order_id;
      if (!orderId) throw new Error(`PaymentIntent ${pi.id} has no order_id`);

      // Stripe's processing fee, for true profit reporting (may not be settled yet).
      let fee: number | null = null;
      try {
        const full = await stripe().paymentIntents.retrieve(pi.id, { expand: ["latest_charge.balance_transaction"] });
        const charge = full.latest_charge as Stripe.Charge | null;
        const bt = charge?.balance_transaction as Stripe.BalanceTransaction | null | undefined;
        fee = bt && typeof bt === "object" ? bt.fee : null;
      } catch { /* fee is optional */ }

      const { error } = await admin.rpc("svc_mark_order_paid", {
        p_order_id: orderId, p_payment_intent_id: pi.id, p_amount_cents: pi.amount_received, p_fee_cents: fee,
      });
      if (error) throw new Error(error.message);
      // Send the order alerts right after responding to Stripe.
      after(async () => { await processOutbox().catch((e) => console.error("[webhook] outbox", e)); });
    } else if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object as Stripe.PaymentIntent;
      await admin.rpc("svc_mark_payment_failed", {
        p_payment_intent_id: pi.id, p_reason: pi.last_payment_error?.message ?? "failed",
      });
    }
    await admin.rpc("svc_finish_payment_event", { p_event_id: event.id });
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[webhook]", event.type, err);
    await admin.rpc("svc_finish_payment_event", { p_event_id: event.id, p_error: String(err).slice(0, 2000) });
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
