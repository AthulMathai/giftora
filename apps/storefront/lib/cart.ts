import "server-only";
import { createClient } from "./supabase/server";

export interface CartLine {
  variant_id: string;
  quantity: number;
  sku: string;
  label: string;
  price_cents: number | null;
  product: { slug: string; name: string; status: string };
  image_url: string | null;
  purchasable_qty: number;
}

/** The signed-in customer's cart, with live price and availability per line. */
export async function getCart(): Promise<{ cartId: string | null; lines: CartLine[]; subtotalCents: number; count: number }> {
  const supabase = await createClient();
  const { data: cart } = await supabase.from("carts").select("id").maybeSingle();
  if (!cart) return { cartId: null, lines: [], subtotalCents: 0, count: 0 };

  const { data, error } = await supabase
    .from("cart_items")
    .select("variant_id, quantity, added_at, product_variants ( sku, label, price_cents, products ( slug, name, status, product_images ( url, sort_order ) ) )")
    .eq("cart_id", cart.id)
    .order("added_at");
  if (error) throw error;

  type Row = {
    variant_id: string; quantity: number;
    product_variants: { sku: string; label: string; price_cents: number | null;
      products: { slug: string; name: string; status: string; product_images: { url: string; sort_order: number }[] } } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const ids = rows.map((r) => r.variant_id);
  const avail = new Map<string, number>();
  if (ids.length) {
    const { data: a } = await supabase.rpc("variant_availability", { p_variant_ids: ids });
    for (const r of (a ?? []) as { variant_id: string; purchasable_qty: number }[]) avail.set(r.variant_id, r.purchasable_qty);
  }

  const lines: CartLine[] = rows
    .filter((r) => r.product_variants)
    .map((r) => ({
      variant_id: r.variant_id,
      quantity: r.quantity,
      sku: r.product_variants!.sku,
      label: r.product_variants!.label,
      price_cents: r.product_variants!.price_cents,
      product: { slug: r.product_variants!.products.slug, name: r.product_variants!.products.name, status: r.product_variants!.products.status },
      image_url: [...(r.product_variants!.products.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]?.url ?? null,
      purchasable_qty: avail.get(r.variant_id) ?? 0,
    }));
  const subtotalCents = lines.reduce((s, l) => s + (l.price_cents ?? 0) * l.quantity, 0);
  return { cartId: cart.id, lines, subtotalCents, count: lines.reduce((s, l) => s + l.quantity, 0) };
}

/** Lines that can't be bought as they stand (sold out, too many, or no longer for sale). */
export function cartProblems(lines: CartLine[]): string[] {
  const problems: string[] = [];
  for (const l of lines) {
    const forSale = ["active", "seasonal"].includes(l.product.status) && l.price_cents !== null;
    if (!forSale) problems.push(`${l.product.name} (${l.label}) is no longer available.`);
    else if (l.purchasable_qty === 0) problems.push(`${l.product.name} (${l.label}) just sold out.`);
    else if (l.quantity > l.purchasable_qty) problems.push(`Only ${l.purchasable_qty} of ${l.product.name} (${l.label}) left.`);
  }
  return problems;
}
