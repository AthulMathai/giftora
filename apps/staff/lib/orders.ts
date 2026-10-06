import "server-only";
import { createAdminClient } from "./supabase/admin";

export interface StaffOrderItem {
  sku: string; product: string; variant: string; quantity: number; unit_price_cents: number;
  status: string; unit_cost_cents?: number;
}
export interface StaffOrder {
  id: string; order_number: string; status: string; payment_status: string; email: string; customer: string;
  shipping_address: Record<string, string | null>; shipping_method_name: string; total_cents: number;
  ship_by: string | null; placed_at: string; paid_at: string | null; shipped_at: string | null;
  carrier: string | null; tracking_number: string | null; staff_note: string | null;
  items: StaffOrderItem[]; profit_cents?: number | null;
  batch?: string | null; batch_id?: string | null; bin?: string | null;
}

/** Orders visible to this staff member. Cost/profit appear only if their role has finance.view. */
export async function staffOrders(actor: string, statuses?: string[]): Promise<StaffOrder[]> {
  const { data, error } = await createAdminClient().rpc("svc_staff_orders", {
    p_actor: actor, p_statuses: statuses ?? null, p_limit: 200,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as StaffOrder[];
}

export interface PickLine { sku: string; product: string; variant: string; aisle: string | null; supplier: string | null; total_qty: number; orders: string[] }

export async function pickSummary(actor: string): Promise<PickLine[]> {
  const { data, error } = await createAdminClient().rpc("svc_pick_summary", { p_actor: actor });
  if (error) throw new Error(error.message);
  return (data ?? []) as PickLine[];
}

export const cad = (c: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(c / 100);
export const dateTime = (iso: string | null) => iso
  ? new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(iso))
  : "";
