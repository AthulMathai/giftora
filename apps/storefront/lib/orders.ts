import "server-only";
import { createClient } from "./supabase/server";

// Explicit columns: customers are not granted every column on orders (e.g. staff notes).
export const ORDER_COLUMNS =
  "id, order_number, status, payment_status, email, shipping_address, shipping_method_name, " +
  "subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents, tax_breakdown, " +
  "placed_at, paid_at, ship_by, carrier, tracking_number, tracking_url, shipped_at, delivered_at";

export interface OrderSummary {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  email: string;
  shipping_address: Record<string, string | null>;
  shipping_method_name: string;
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  tax_breakdown: { province?: string; gst?: number; hst?: number; pst?: number };
  placed_at: string;
  paid_at: string | null;
  ship_by: string | null;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
}

export const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  paid: "Order received",
  processing: "Being prepared",
  ready_to_ship: "Being prepared",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  closed: "Completed",
};

export async function listMyOrders(): Promise<OrderSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .neq("status", "cancelled")
    .neq("status", "pending_payment")
    .order("placed_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as OrderSummary[];
}

export async function getMyOrder(orderNumber: string) {
  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from("orders").select(ORDER_COLUMNS).eq("order_number", orderNumber).maybeSingle();
  if (error) throw error;
  if (!order) return null;
  const o = order as unknown as OrderSummary;
  const [{ data: items }, { data: events }] = await Promise.all([
    supabase.from("order_items")
      .select("id, product_name, variant_label, sku, quantity, unit_price_cents, line_total_cents")
      .eq("order_id", o.id).order("sku"),
    supabase.from("order_events")
      .select("id, type, message, data, created_at").eq("order_id", o.id).order("created_at"),
  ]);
  return {
    order: o,
    items: (items ?? []) as { id: string; product_name: string; variant_label: string; sku: string;
      quantity: number; unit_price_cents: number; line_total_cents: number }[],
    events: (events ?? []) as { id: number; type: string; message: string | null; created_at: string }[],
  };
}

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "America/Toronto" }).format(new Date(iso));
}
