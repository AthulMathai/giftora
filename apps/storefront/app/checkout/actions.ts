"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Postgres error codes raised by public.start_checkout().
const REASONS: Record<string, string> = {
  P0001: "empty",
  P0002: "address",
  P0003: "shipping",
  P0004: "unavailable",
  P0005: "stock",
};

export async function startCheckout(formData: FormData) {
  const addressId = String(formData.get("address_id") ?? "");
  const method = String(formData.get("shipping_method") ?? "");
  if (!addressId) redirect("/checkout?error=address");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=/checkout");

  const { data, error } = await supabase.rpc("start_checkout", {
    p_shipping_address_id: addressId,
    p_shipping_method: method,
  });
  if (error) {
    const reason = REASONS[error.code ?? ""] ?? "failed";
    const detail = reason === "stock" || reason === "unavailable" ? `&sku=${encodeURIComponent(error.message.split(" ").pop() ?? "")}` : "";
    redirect(`/checkout?error=${reason}${detail}`);
  }
  const row = (data as { order_id: string }[])[0];
  if (!row) redirect("/checkout?error=failed");
  redirect(`/checkout/pay?order=${row.order_id}`);
}
