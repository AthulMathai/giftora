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

export interface Category { id: string; slug: string; name: string; description: string | null; seo_title: string | null; seo_description: string | null }

export async function listCategories(): Promise<Category[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("categories")
    .select("id, slug, name, description, seo_title, seo_description").order("sort_order").order("name");
  if (error) throw error;
  return (data ?? []) as Category[];
}

export interface Collection { id: string; slug: string; name: string; description: string | null; seo_title: string | null; seo_description: string | null }

export async function listCollections(): Promise<Collection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("collections")
    .select("id, slug, name, description, seo_title, seo_description").order("name");
  if (error) throw error;
  return (data ?? []) as Collection[];
}

export async function collectionProductIds(collectionId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("collection_products")
    .select("product_id").eq("collection_id", collectionId).order("sort_order");
  if (error) throw error;
  return (data ?? []).map((r: { product_id: string }) => r.product_id);
}

/** Ranked product ids for a free-text search (typo tolerant). */
export async function searchProductIds(q: string): Promise<string[]> {
  if (!q.trim()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_products", { p_q: q, p_limit: 120 });
  if (error) throw error;
  return (data as { product_id: string }[]).map((r) => r.product_id);
}

export function minPrice(p: Product): number | null {
  const all = prices(p);
  return all.length ? Math.min(...all) : null;
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
