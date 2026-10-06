import "server-only";
import { createAdminClient } from "./supabase/admin";

/**
 * Delivers queued side effects from internal.outbox_events: staff order alerts (email + WhatsApp)
 * and customer emails. Each event is claimed with SKIP LOCKED, so overlapping runs never double-send;
 * failures are retried with backoff by the database.
 */

type Recipient = { to: string; finance: boolean };
interface AlertItem { sku: string; product: string; variant: string; quantity: number; unit_price_cents: number; unit_cost_cents?: number; expected_profit_cents?: number }
interface Alert {
  order_number: string; customer: string; email: string; shipping_method: string; ship_to: string;
  payment_status: string; total_cents: number; ship_by: string; items: AlertItem[];
  expected_profit_cents?: number; action_required: string;
}

const cad = (c: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(c / 100);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const site = () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

function recipients(value: unknown): Recipient[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v): Recipient[] => {
    if (typeof v === "string" && v) return [{ to: v, finance: false }];
    if (v && typeof v === "object" && typeof (v as { to?: unknown }).to === "string") {
      return [{ to: (v as { to: string }).to, finance: Boolean((v as { finance?: unknown }).finance) }];
    }
    return [];
  });
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn(`[notify] RESEND_API_KEY not set; skipped email "${subject}" to ${to}`); return; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Giftora <orders@giftora.ca>", to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`email to ${to} failed: ${res.status} ${await res.text()}`);
}

/** WhatsApp Cloud API: business-initiated messages must use a pre-approved template. */
async function sendWhatsApp(to: string, params: string[]) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) { console.warn("[notify] WhatsApp not configured; skipped"); return; }
  const version = process.env.WHATSAPP_API_VERSION ?? "v23.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/[^\d]/g, ""),
      type: "template",
      template: {
        name: process.env.WHATSAPP_TEMPLATE_NEW_ORDER ?? "new_order_alert",
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "en" },
        components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text.slice(0, 1000) })) }],
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp to ${to} failed: ${res.status} ${await res.text()}`);
}

function itemsLine(a: Alert, finance: boolean): string {
  return a.items.map((i) =>
    `${i.quantity}× ${i.sku} ${i.product} (${i.variant}) @ ${cad(i.unit_price_cents)}` +
    (finance && i.unit_cost_cents !== undefined ? ` [cost ${cad(i.unit_cost_cents)}]` : "")).join("; ");
}

function staffEmail(a: Alert, finance: boolean, late: boolean) {
  const rows = a.items.map((i) => `<tr><td style="padding:4px 8px;font-family:monospace">${esc(i.sku)}</td><td style="padding:4px 8px">${esc(i.product)} — ${esc(i.variant)}</td><td style="padding:4px 8px;text-align:right">${i.quantity}</td><td style="padding:4px 8px;text-align:right">${cad(i.unit_price_cents)}</td>${finance ? `<td style="padding:4px 8px;text-align:right">${i.unit_cost_cents !== undefined ? cad(i.unit_cost_cents) : ""}</td>` : ""}</tr>`).join("");
  const html = `<div style="font-family:system-ui,sans-serif">
    ${late ? `<p style="color:#b8412b"><strong>Paid after the stock hold expired — check availability before acquiring.</strong></p>` : ""}
    <h2 style="margin:0 0 8px">New order ${esc(a.order_number)} · ${cad(a.total_cents)}</h2>
    <p>${esc(a.customer)} (${esc(a.email)}) · ${esc(a.ship_to)} · ${esc(a.shipping_method)} · ship by ${esc(a.ship_by)}</p>
    <table style="border-collapse:collapse;border:1px solid #ddd"><tr><th align="left" style="padding:4px 8px">SKU</th><th align="left" style="padding:4px 8px">Item</th><th style="padding:4px 8px">Qty</th><th style="padding:4px 8px">Price</th>${finance ? `<th style="padding:4px 8px">Cost</th>` : ""}</tr>${rows}</table>
    ${finance && a.expected_profit_cents !== undefined ? `<p>Expected profit: <strong>${cad(a.expected_profit_cents)}</strong> (before shipping and fees)</p>` : ""}
    <p>Payment: ${esc(a.payment_status)} · <strong>Action required: ${esc(a.action_required)}</strong></p></div>`;
  const text = `New order ${a.order_number} ${cad(a.total_cents)}\n${itemsLine(a, finance)}\nShip by ${a.ship_by}. ${a.action_required}.`;
  return { subject: `${late ? "[CHECK STOCK] " : ""}New order ${a.order_number} · ${cad(a.total_cents)}`, html, text };
}

function customerConfirmation(a: Alert) {
  const rows = a.items.map((i) => `<li>${i.quantity} × ${esc(i.product)} — ${esc(i.variant)} · ${cad(i.unit_price_cents * i.quantity)}</li>`).join("");
  const link = `${site()}/account/orders/${encodeURIComponent(a.order_number)}`;
  return {
    subject: `Your Giftora order ${a.order_number}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px"><h2>Thank you, ${esc(a.customer.split(" ")[0])}!</h2>
      <p>We've received your order <strong>${esc(a.order_number)}</strong> (${cad(a.total_cents)}). We pick every gift by hand and will email you tracking as soon as it ships.</p>
      <ul>${rows}</ul><p><a href="${link}">View your order</a></p></div>`,
    text: `Thank you! Order ${a.order_number} (${cad(a.total_cents)}) is confirmed. Track it: ${link}`,
  };
}

async function handle(topic: string, payload: Record<string, unknown>) {
  const admin = createAdminClient();
  const orderId = String(payload.order_id ?? "");
  const setting = async (key: string) => (await admin.rpc("svc_get_setting", { p_key: key })).data;
  const alert = async (finance: boolean) => {
    const { data, error } = await admin.rpc("svc_order_alert", { p_order_id: orderId, p_include_finance: finance });
    if (error || !data) throw new Error(`order ${orderId} not found for alert`);
    return data as Alert;
  };

  if (topic === "order.paid") {
    const late = payload.late_payment === true;
    const emails = recipients(await setting("notifications.staff_emails"));
    const phones = recipients(await setting("notifications.staff_whatsapp"));
    const [plain, withFinance] = await Promise.all([alert(false), alert(true)]);
    for (const r of emails) {
      const m = staffEmail(r.finance ? withFinance : plain, r.finance, late);
      await sendEmail(r.to, m.subject, m.html, m.text);
    }
    for (const r of phones) {
      const a = r.finance ? withFinance : plain;
      await sendWhatsApp(r.to, [a.order_number, itemsLine(a, r.finance), cad(a.total_cents), a.ship_by]);
    }
    const c = customerConfirmation(plain);
    await sendEmail(plain.email, c.subject, c.html, c.text);
    return;
  }

  if (topic === "order.shipped") {
    const a = await alert(false);
    const { data } = await admin.rpc("svc_order_tracking", { p_order_id: orderId });
    const t = (data ?? {}) as { carrier?: string; tracking_number?: string; tracking_url?: string };
    const link = `${site()}/account/orders/${encodeURIComponent(a.order_number)}`;
    await sendEmail(a.email, `Your Giftora order ${a.order_number} has shipped`,
      `<div style="font-family:system-ui,sans-serif;max-width:520px"><h2>It's on its way!</h2>
        <p>Order <strong>${esc(a.order_number)}</strong> shipped with ${esc(t.carrier)}.</p>
        <p>Tracking: ${t.tracking_url ? `<a href="${esc(t.tracking_url)}">${esc(t.tracking_number)}</a>` : esc(t.tracking_number)}</p>
        <p><a href="${link}">View your order</a></p></div>`,
      `Order ${a.order_number} shipped with ${t.carrier}. Tracking: ${t.tracking_number}. ${link}`);
    return;
  }

  if (topic === "order.refunded") {
    const a = await alert(false);
    const amount = Number(payload.amount_cents ?? 0);
    const cancelled = payload.cancelled === true;
    const link = `${site()}/account/orders/${encodeURIComponent(a.order_number)}`;
    await sendEmail(a.email, cancelled ? `Your Giftora order ${a.order_number} was cancelled` : `A refund for your Giftora order ${a.order_number}`,
      `<div style="font-family:system-ui,sans-serif;max-width:520px"><h2>${cancelled ? "We're sorry — your order was cancelled" : "We've issued a refund"}</h2>
        <p>We've refunded <strong>${cad(amount)}</strong> to your original payment method for order <strong>${esc(a.order_number)}</strong>.
        It usually appears within 5–10 business days.</p>
        ${cancelled ? "<p>We couldn't get one or more of your items from our supplier. Nothing more will be charged.</p>" : ""}
        <p><a href="${link}">View your order</a></p></div>`,
      `Refund of ${cad(amount)} issued for order ${a.order_number}. ${link}`);
    return;
  }

  if (topic === "order.paid_after_expiry") return; // covered by the [CHECK STOCK] flag on order.paid

  console.warn(`[notify] no handler for topic ${topic}`);
}

export async function processOutbox(limit = 20): Promise<{ sent: number; failed: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("svc_claim_outbox", { p_limit: limit });
  if (error) throw error;
  let sent = 0, failed = 0;
  for (const e of (data ?? []) as { id: number; topic: string; payload: Record<string, unknown> }[]) {
    try {
      await handle(e.topic, e.payload);
      await admin.rpc("svc_complete_outbox", { p_id: e.id });
      sent++;
    } catch (err) {
      failed++;
      console.error(`[notify] event ${e.id} (${e.topic}) failed`, err);
      await admin.rpc("svc_complete_outbox", { p_id: e.id, p_error: String(err).slice(0, 2000) });
    }
  }
  return { sent, failed };
}
