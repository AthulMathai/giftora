"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendly } from "@/lib/catalog";
import type { Quote, QuoteInput, StaffOrderInput, VariantHit } from "@/lib/staff-orders";
import { stripe } from "@/lib/stripe";

const TRACKING_URL: Record<string, (n: string) => string> = {
  "Canada Post": (n) => `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${encodeURIComponent(n)}`,
  Purolator: (n) => `https://www.purolator.com/en/shipping/tracker?pin=${encodeURIComponent(n)}`,
  UPS: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  FedEx: (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
};

/** Asks the storefront to send queued customer emails now (it owns the email sender). */
async function flushNotifications() {
  const url = process.env.STOREFRONT_URL;
  const secret = process.env.CRON_SECRET;
  if (!url || !secret) return;
  await fetch(`${url}/api/jobs/outbox`, { headers: { Authorization: `Bearer ${secret}` }, cache: "no-store" })
    .catch((e) => console.error("[staff] notification flush failed", e));
}

export async function updateStatus(formData: FormData) {
  const staff = await requireStaff("orders.edit");
  const orderId = String(formData.get("order_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const carrier = String(formData.get("carrier") ?? "").trim() || null;
  const tracking = String(formData.get("tracking_number") ?? "").replace(/\s+/g, "") || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  const back = String(formData.get("back") ?? "/orders");

  const { error } = await createAdminClient().rpc("svc_update_order_status", {
    p_actor: staff.userId,
    p_order_id: orderId,
    p_status: status,
    p_carrier: carrier,
    p_tracking_number: tracking,
    p_tracking_url: carrier && tracking && TRACKING_URL[carrier] ? TRACKING_URL[carrier](tracking) : null,
    p_note: note,
  });
  if (error) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
  if (status === "shipped") await flushNotifications();
  revalidatePath("/orders");
  revalidatePath("/");
}

/**
 * Refund through Stripe, then record it. The idempotency key comes from the form, so a
 * double-click or retry can never refund twice.
 */
export async function refundOrder(formData: FormData) {
  const staff = await requireStaff("refunds.create");
  const orderId = String(formData.get("order_id") ?? "");
  const back = String(formData.get("back") ?? "/orders");
  const nonce = String(formData.get("nonce") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const cancel = formData.get("cancel") === "on";
  const fail = (msg: string): never => redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);

  const raw = String(formData.get("amount") ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) fail("Enter the refund amount, like 12.50");
  const amount = Math.round(Number(raw) * 100);
  if (!reason) fail("A reason is required for refunds.");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(nonce)) fail("Please reload the page and try the refund again.");

  const admin = createAdminClient();
  const { data: pay, error: payErr } = await admin.rpc("svc_order_payment", { p_actor: staff.userId, p_order_id: orderId });
  if (payErr || !pay) fail(payErr?.message ?? "No payment found for this order.");
  const p = pay as { payment_intent_id: string; provider: string | null; amount_cents: number; refunded_cents: number; order_number: string };
  if (amount <= 0 || amount > p.amount_cents - p.refunded_cents) {
    fail(`You can refund at most ${(p.amount_cents - p.refunded_cents) / 100} on ${p.order_number}.`);
  }
  // Orders paid by cash, e-transfer, card terminal or cheque never went through Stripe: staff
  // return the money by hand and we only record it. The nonce keeps a double-click from recording twice.
  const manual = (p.provider ?? "stripe") !== "stripe";

  let refundId: string;
  if (manual) {
    refundId = `manual-${nonce}`;
  } else {
    try {
      const refund = await stripe().refunds.create(
        { payment_intent: p.payment_intent_id, amount, reason: "requested_by_customer",
          metadata: { order_id: orderId, order_number: p.order_number, staff_user: staff.userId, note: reason.slice(0, 450) } },
        { idempotencyKey: `giftora-refund-${orderId}-${nonce}` },
      );
      if (refund.status === "failed" || refund.status === "canceled") fail(`Stripe refused the refund (${refund.status}).`);
      refundId = refund.id;
    } catch (e) {
      if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
      fail(`Stripe error: ${(e as Error).message}`);
    }
  }

  const { error } = await admin.rpc("svc_refund_record", {
    p_actor: staff.userId, p_order_id: orderId, p_amount_cents: amount, p_reason: reason,
    p_provider_refund_id: refundId!, p_cancel_order: cancel,
  });
  if (error) {
    fail(manual
      ? `The refund couldn't be recorded: ${error.message}`
      : `Refund ${refundId!} went through in Stripe but couldn't be recorded: ${error.message}. Tell the owner.`);
  }
  await flushNotifications();
  revalidatePath("/orders");
  revalidatePath("/");
  redirect(`${back}${back.includes("?") ? "&" : "?"}refunded=${encodeURIComponent(p.order_number)}${manual ? "&manual=1" : ""}`);
}

// ---------------------------------------------------------------------------
// Staff-created orders (phone, in person, social, email, marketplace)
// ---------------------------------------------------------------------------

/** Finds sellable variants by product name, SKU prefix or exact barcode. */
export async function searchVariants(q: string): Promise<VariantHit[]> {
  const staff = await requireStaff("orders.edit");
  const query = String(q ?? "").trim().slice(0, 100);
  if (query.length < 2) return [];
  const { data, error } = await createAdminClient().rpc("svc_order_variant_search", { p_actor: staff.userId, p_q: query });
  if (error) throw new Error(friendly(error.message));
  return (data ?? []) as VariantHit[];
}

/** Live totals (prices, shipping, tax) for the new-order screen. Nothing is reserved. */
export async function quoteStaffOrder(input: QuoteInput): Promise<{ quote?: Quote; error?: string }> {
  const staff = await requireStaff("orders.edit");
  if (!input.items.length) return {};
  const { data, error } = await createAdminClient().rpc("svc_staff_order_quote", {
    p_actor: staff.userId,
    p: {
      items: input.items, shipping_method: input.shipping_method,
      shipping_address: { province: input.province }, discount_cents: Math.max(0, Math.round(input.discount_cents || 0)),
    },
  });
  if (error) return { error: friendly(error.message) };
  return { quote: data as Quote };
}

/** Creates the order (stock is reserved straight away). Redirects on success; returns an error message otherwise. */
export async function createStaffOrder(input: StaffOrderInput): Promise<{ error: string }> {
  const staff = await requireStaff("orders.edit");
  const { data, error } = await createAdminClient().rpc("svc_staff_order_create", { p_actor: staff.userId, p: input });
  if (error) return { error: friendly(error.message) };
  const r = data as { order_id: string; order_number: string; status: string; linked_account: boolean };
  if (r.status === "paid") await flushNotifications();
  revalidatePath("/orders");
  revalidatePath("/");
  const qs = new URLSearchParams({ created: r.order_number, status: r.status === "paid" ? "open" : "unpaid" });
  if (r.linked_account) qs.set("linked", "1");
  redirect(`/orders?${qs}`);
}

export async function markStaffOrderPaid(formData: FormData) {
  const staff = await requireStaff("orders.edit");
  const back = String(formData.get("back") ?? "/orders");
  const fail = (msg: string): never => redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
  const rawFee = String(formData.get("fee") ?? "").replace(/[$,\s]/g, "");
  if (rawFee && !/^\d+(\.\d{1,2})?$/.test(rawFee)) fail("Enter the card fee like 1.25, or leave it empty.");
  const { error } = await createAdminClient().rpc("svc_staff_order_mark_paid", {
    p_actor: staff.userId,
    p_order_id: String(formData.get("order_id") ?? ""),
    p_method: String(formData.get("method") ?? ""),
    p_reference: String(formData.get("reference") ?? "").trim() || null,
    p_fee_cents: rawFee ? Math.round(Number(rawFee) * 100) : null,
  });
  if (error) fail(friendly(error.message));
  await flushNotifications();
  revalidatePath("/orders");
  revalidatePath("/");
  redirect(`${back}${back.includes("?") ? "&" : "?"}paid=${encodeURIComponent(String(formData.get("order_number") ?? ""))}`);
}

export async function cancelStaffOrder(formData: FormData) {
  const staff = await requireStaff("orders.edit");
  const back = String(formData.get("back") ?? "/orders");
  const { error } = await createAdminClient().rpc("svc_staff_order_cancel", {
    p_actor: staff.userId,
    p_order_id: String(formData.get("order_id") ?? ""),
    p_reason: String(formData.get("reason") ?? "").trim() || null,
  });
  if (error) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(friendly(error.message))}`);
  revalidatePath("/orders");
  revalidatePath("/");
  redirect(`${back}${back.includes("?") ? "&" : "?"}cancelled=${encodeURIComponent(String(formData.get("order_number") ?? ""))}`);
}
