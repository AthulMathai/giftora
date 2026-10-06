"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const enc = encodeURIComponent;
const withError = (path: string, msg: string) => `${path}${path.includes("?") ? "&" : "?"}error=${enc(msg)}`;

export async function createSession(formData: FormData) {
  const staff = await requireStaff("fulfillment.operate");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? from);
  const { data, error } = await createAdminClient().rpc("svc_session_create", {
    p_actor: staff.userId, p_from: from, p_to: to, p_notes: String(formData.get("notes") ?? "") || null,
  });
  if (error) redirect(withError(`/fulfillment?from=${from}&to=${to}`, error.message));
  revalidatePath("/fulfillment");
  redirect(`/fulfillment/${data}?tab=pick`);
}

export async function pickAll(formData: FormData) {
  const staff = await requireStaff("fulfillment.operate");
  const sessionId = String(formData.get("session_id"));
  const { error } = await createAdminClient().rpc("svc_pick_all", { p_actor: staff.userId, p_session_id: sessionId });
  if (error) redirect(withError(`/fulfillment/${sessionId}`, error.message));
  revalidatePath(`/fulfillment/${sessionId}`);
}

export async function shipBatch(formData: FormData) {
  const staff = await requireStaff("orders.edit");
  const sessionId = String(formData.get("session_id"));
  const { data, error } = await createAdminClient().rpc("svc_batch_ship", {
    p_actor: staff.userId, p_session_id: sessionId, p_carrier: String(formData.get("carrier") ?? ""),
  });
  if (error) redirect(withError(`/fulfillment/${sessionId}`, error.message));
  // Send the "shipped" emails now rather than waiting for the daily job.
  const url = process.env.STOREFRONT_URL, secret = process.env.CRON_SECRET;
  if (url && secret) await fetch(`${url}/api/jobs/outbox`, { headers: { Authorization: `Bearer ${secret}` }, cache: "no-store" }).catch(() => {});
  revalidatePath("/fulfillment", "layout");
  redirect(`/fulfillment/${sessionId}?shipped=${data}`);
}

export async function updatePick(formData: FormData) {
  const staff = await requireStaff("fulfillment.operate");
  const sessionId = String(formData.get("session_id"));
  const n = (k: string) => Math.max(0, Math.floor(Number(formData.get(k) || 0)));
  const { error } = await createAdminClient().rpc("svc_pick_update", {
    p_actor: staff.userId, p_pick_line_id: String(formData.get("pick_line_id")),
    p_picked: n("picked"), p_short: n("short"), p_damaged: n("damaged"), p_notes: String(formData.get("notes") ?? "") || null,
  });
  const path = `/fulfillment/${sessionId}?tab=pick`;
  if (error) redirect(withError(path, error.message));
  revalidatePath(`/fulfillment/${sessionId}`);
}

export interface ScanResult {
  result: "ok" | "wrong_variant" | "not_required" | "unknown_code" | "not_in_order" | "already_packed" | "not_ready" | "open_pack" | "error";
  message?: string; pack_qty?: number; pack_kind?: string; order_id?: string; bin?: string; order_number?: string; sku?: string; product?: string; variant?: string;
  sorted?: number; packed?: number; required?: number; order_complete?: boolean;
}

export async function sortScan(sessionId: string, code: string, key: string): Promise<ScanResult> {
  const staff = await requireStaff("fulfillment.operate");
  const { data, error } = await createAdminClient().rpc("svc_sort_scan", {
    p_actor: staff.userId, p_session_id: sessionId, p_code: code.trim(), p_key: key,
  });
  if (error) return { result: "error", message: error.message };
  return data as ScanResult;
}

export async function packScan(orderId: string, code: string, key: string): Promise<ScanResult> {
  const staff = await requireStaff("fulfillment.operate");
  const { data, error } = await createAdminClient().rpc("svc_pack_scan", {
    p_actor: staff.userId, p_order_id: orderId, p_code: code.trim(), p_key: key,
  });
  if (error) return { result: "error", message: error.message };
  return data as ScanResult;
}

export async function overridePack(formData: FormData) {
  const staff = await requireStaff("fulfillment.override");
  const sessionId = String(formData.get("session_id"));
  const orderId = String(formData.get("order_id"));
  const path = `/fulfillment/${sessionId}?tab=pack&order=${orderId}`;
  const { error } = await createAdminClient().rpc("svc_override_pack", {
    p_actor: staff.userId, p_order_id: orderId, p_reason: String(formData.get("reason") ?? ""),
  });
  if (error) redirect(withError(path, error.message));
  revalidatePath(`/fulfillment/${sessionId}`);
  redirect(path);
}

export async function removeFromSession(formData: FormData) {
  const staff = await requireStaff("orders.edit");
  const sessionId = String(formData.get("session_id"));
  const { error } = await createAdminClient().rpc("svc_session_remove_order", {
    p_actor: staff.userId, p_session_id: sessionId, p_order_id: String(formData.get("order_id")),
    p_reason: String(formData.get("reason") ?? "") || "Removed by staff",
  });
  const path = `/fulfillment/${sessionId}?tab=orders`;
  if (error) redirect(withError(path, error.message));
  revalidatePath(`/fulfillment/${sessionId}`);
  redirect(path);
}

export async function closeSession(formData: FormData) {
  const staff = await requireStaff("fulfillment.operate");
  const sessionId = String(formData.get("session_id"));
  const { error } = await createAdminClient().rpc("svc_session_close", { p_actor: staff.userId, p_session_id: sessionId });
  if (error) redirect(withError(`/fulfillment/${sessionId}?tab=orders`, error.message));
  revalidatePath("/fulfillment");
  redirect("/fulfillment?closed=1");
}

export async function addBins(formData: FormData) {
  const staff = await requireStaff("fulfillment.operate");
  const { error } = await createAdminClient().rpc("svc_bins_add", { p_actor: staff.userId, p_count: Number(formData.get("count") || 0) });
  if (error) redirect(withError("/fulfillment/bins", error.message));
  revalidatePath("/fulfillment/bins");
}

export async function resolveException(formData: FormData) {
  const staff = await requireStaff("fulfillment.operate");
  const { error } = await createAdminClient().rpc("svc_exception_resolve", {
    p_actor: staff.userId, p_exception_id: String(formData.get("id")), p_resolution: String(formData.get("resolution") ?? ""),
  });
  if (error) redirect(withError("/exceptions", error.message));
  revalidatePath("/exceptions");
  revalidatePath("/");
}

export async function reportException(formData: FormData) {
  const staff = await requireStaff("fulfillment.operate");
  const back = String(formData.get("back") ?? "/exceptions");
  const { error } = await createAdminClient().rpc("svc_exception_create", {
    p_actor: staff.userId,
    p: { kind: formData.get("kind"), order_id: formData.get("order_id") || null, session_id: formData.get("session_id") || null,
         sku: formData.get("sku") || null, quantity: formData.get("quantity") || null, notes: formData.get("notes") },
  });
  if (error) redirect(withError(back, error.message));
  revalidatePath("/exceptions");
  redirect(back);
}
