import { createClient } from "./supabase/server";

export interface Variant {
  id: string;
  sku: string;
  label: string;
  options: Record<string, string>;
  price_cents: number | null;
  compare_at_cents: number | null;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  tags: string[];
  occasions: string[];
  recipients: string[];
  option_names: string[];
  seo_title: string | null;
  seo_description: string | null;
  category: { slug: string; name: string } | null;
  product_variants: Variant[];
  product_images: { url: string; alt_text: string; sort_order: number }[];
}

const PRODUCT_SELECT = `
  id, slug, name, description, status, tags, occasions, recipients, option_names,
  seo_title, seo_description,
  category:categories ( slug, name ),
  product_variants ( id, sku, label, options, price_cents, compare_at_cents ),
  product_images ( url, alt_text, sort_order )
`;

export async function listProducts(): Promise<Product[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .in("status", ["active", "seasonal"])
    .order("published_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Product[];
}

export async function getProduct(slug: string): Promise<Product | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").select(PRODUCT_SELECT).eq("slug", slug).maybeSingle();
  if (error) throw error;
  return (data as unknown as Product) ?? null;
}

/** How many of each variant can be bought right now (capped at 10; never the supplier's real count). */
export async function getAvailability(variantIds: string[]): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("variant_availability", { p_variant_ids: variantIds });
  if (error) throw error;
  return new Map((data as { variant_id: string; purchasable_qty: number }[]).map((r) => [r.variant_id, r.purchasable_qty]));
}

export function prices(p: Product): number[] {
  return p.product_variants.map((v) => v.price_cents).filter((c): c is number => c !== null);
}
