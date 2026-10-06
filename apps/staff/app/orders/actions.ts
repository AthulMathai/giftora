"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

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
