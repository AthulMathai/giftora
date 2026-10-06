import "server-only";
import { createAdminClient } from "./supabase/admin";

export interface PickLine {
  id: string; variant_id: string; sku: string; product: string; variant: string; aisle: string | null;
  required: number; picked: number; short: number; damaged: number; notes: string | null; barcode: string | null;
}
export interface SessionOrderItem { order_item_id: string; sku: string; product: string; variant: string; quantity: number; sorted: number; packed: number }
export interface SessionOrder {
  order_id: string; order_number: string; status: string; position: number; bin: string | null; customer: string;
  ship_by: string | null; shipping_method: string; carrier: string | null; tracking_number: string | null; removed: boolean;
  items: SessionOrderItem[];
}
export interface SessionDetail {
  id: string; code: string; status: string; date_from: string; date_to: string; notes: string | null;
  created_at: string; completed_at: string | null; created_by: string | null;
  pick_lines: PickLine[]; orders: SessionOrder[];
  exceptions: { id: string; kind: string; status: string; sku: string | null; quantity: number | null; notes: string | null; order_number: string | null; created_at: string }[];
}
export interface SessionRow {
  id: string; code: string; status: string; date_from: string; date_to: string; created_at: string; completed_at: string | null;
  created_by: string | null; orders: number; units: number; shipped: number;
}
export interface VolumeRow { day: string; orders: number; lines: number; unique_skus: number; units: number; waiting: number; in_progress: number; shipped: number }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createAdminClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const getVolume = (actor: string, from: string, to: string) =>
  rpc<VolumeRow[]>("svc_fulfillment_volume", { p_actor: actor, p_from: from, p_to: to });
export interface PackBreakdown { outers: number; inners: number; singles: number; inner_qty: number | null; outer_qty: number | null; inner_barcode: string | null; outer_barcode: string | null }
export const getPickPacks = (actor: string, sessionId: string) =>
  rpc<Record<string, PackBreakdown>>("svc_pick_packs", { p_actor: actor, p_session_id: sessionId });

/** "1 outer (12) + 1 inner (6) + 2 singles" */
export function describePacks(b: PackBreakdown | undefined, required: number): string {
  if (!b || (!b.inner_qty && !b.outer_qty)) return `${required} single${required === 1 ? "" : "s"}`;
  const parts = [
    b.outers ? `${b.outers} outer${b.outers > 1 ? "s" : ""} (${b.outer_qty})` : "",
    b.inners ? `${b.inners} inner${b.inners > 1 ? "s" : ""} (${b.inner_qty})` : "",
    b.singles ? `${b.singles} single${b.singles > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  return parts.join(" + ");
}
export const listSessions = (actor: string) => rpc<SessionRow[]>("svc_sessions", { p_actor: actor });
export const getSession = (actor: string, id: string) => rpc<SessionDetail | null>("svc_session_get", { p_actor: actor, p_session_id: id });

/** YYYY-MM-DD in Toronto time, offset by `days`. */
export function torontoDate(days = 0): string {
  const d = new Date(Date.now() + days * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export const SESSION_STEPS = ["picking", "sorting", "packing", "completed"] as const;
