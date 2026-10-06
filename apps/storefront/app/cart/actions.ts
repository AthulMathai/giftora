"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

async function ensureCart() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, cartId: null };
  const { data: existing } = await supabase.from("carts").select("id").maybeSingle();
  if (existing) return { supabase, user, cartId: existing.id as string };
  const { data: created, error } = await supabase.from("carts").insert({ user_id: user.id }).select("id").single();
  if (error) throw error;
  return { supabase, user, cartId: created.id as string };
}

export async function addToCart(formData: FormData) {
  const variantId = String(formData.get("variant_id") ?? "");
  const quantity = Math.max(1, Math.min(10, Number(formData.get("quantity") ?? 1) || 1));
  const back = safeNext(formData.get("back"), "/");

  const { supabase, user, cartId } = await ensureCart();
  // Account required before anything goes in a cart.
  if (!user || !cartId) redirect(`/sign-in?next=${encodeURIComponent(back)}`);

  const { data: existing } = await supabase
    .from("cart_items").select("quantity").eq("cart_id", cartId).eq("variant_id", variantId).maybeSingle();
  const next = Math.min(10, (existing?.quantity ?? 0) + quantity);
  const { error } = existing
    ? await supabase.from("cart_items").update({ quantity: next }).eq("cart_id", cartId).eq("variant_id", variantId)
    : await supabase.from("cart_items").insert({ cart_id: cartId, variant_id: variantId, quantity: next });
  if (error) redirect(`${back}${back.includes("?") ? "&" : "?"}error=unavailable`);

  revalidatePath("/", "layout");
  redirect("/cart?added=1");
}

export async function updateQuantity(formData: FormData) {
  const variantId = String(formData.get("variant_id") ?? "");
  const quantity = Number(formData.get("quantity"));
  const { supabase, cartId } = await ensureCart();
  if (!cartId) redirect("/sign-in?next=/cart");
  if (!Number.isInteger(quantity) || quantity <= 0) {
    await supabase.from("cart_items").delete().eq("cart_id", cartId).eq("variant_id", variantId);
  } else {
    await supabase.from("cart_items").update({ quantity: Math.min(10, quantity) })
      .eq("cart_id", cartId).eq("variant_id", variantId);
  }
  revalidatePath("/", "layout");
}

export async function removeFromCart(formData: FormData) {
  const variantId = String(formData.get("variant_id") ?? "");
  const { supabase, cartId } = await ensureCart();
  if (!cartId) redirect("/sign-in?next=/cart");
  await supabase.from("cart_items").delete().eq("cart_id", cartId).eq("variant_id", variantId);
  revalidatePath("/", "layout");
}
