import "server-only";
import { createAdminClient } from "./supabase/admin";

export const PRODUCT_STATUSES = [
  "draft", "active", "seasonal", "paused", "out_of_stock", "acquisition_unavailable", "archived", "discontinued",
] as const;

export const STATUS_HELP: Record<string, string> = {
  draft: "Hidden from customers",
  active: "On sale",
  seasonal: "On sale (seasonal)",
  paused: "Hidden, temporarily",
  out_of_stock: "Visible, can't be bought",
  acquisition_unavailable: "Visible, supplier can't provide",
  archived: "Visible for history/SEO, can't be bought",
  discontinued: "Hidden for good",
};

export interface ProductRow {
  id: string; slug: string; name: string; status: string; updated_at: string; category: string | null;
  variants: number; min_price_cents: number | null; max_price_cents: number | null; available: number; image_url: string | null;
}

export interface VariantDetail {
  id: string; sku: string; label: string; options: Record<string, string>; price_cents?: number;
  compare_at_cents?: number; weight_grams?: number; is_active: boolean; sort_order: number; available: number;
  supplier_sku?: string; supplier_barcode?: string; on_hand_qty?: number; supply_status?: string;
  aisle_location?: string; last_checked_at?: string; cost_cents?: number;
  inner_qty?: number | null; inner_barcode?: string | null; outer_qty?: number | null; outer_barcode?: string | null;
  rule?: { rule_type: string; rate: number; min_margin: number; min_profit_cents: number; rounding: string; scope: string };
}

export interface ProductDetail {
  id: string; slug: string; name: string; description: string | null; category_id: string | null; status: string;
  tags: string[]; occasions: string[]; recipients: string[]; option_names: string[];
  seo_title: string | null; seo_description: string | null; published_at: string | null;
  images: { id: string; url: string; alt_text: string; sort_order: number }[];
  variants: VariantDetail[];
}

export interface Category { id: string; slug: string; name: string; description: string | null; parent_id: string | null; sort_order: number; is_visible: boolean; products: number }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createAdminClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const listProducts = (actor: string) => rpc<ProductRow[]>("svc_catalog_products", { p_actor: actor });
export const getProduct = (actor: string, id: string) => rpc<ProductDetail | null>("svc_product_get", { p_actor: actor, p_product_id: id });
export const getVariantPacks = (actor: string, productId: string) =>
  rpc<Record<string, { inner_qty: number | null; inner_barcode: string | null; outer_qty: number | null; outer_barcode: string | null }>>(
    "svc_variant_packs", { p_actor: actor, p_product_id: productId });
export const listCategories = (actor: string) => rpc<Category[]>("svc_categories", { p_actor: actor });

/** "$12.50", "12.5", "1,299" -> cents. Empty -> null. Throws on nonsense. */
export function parseMoney(input: FormDataEntryValue | null): number | null {
  const s = String(input ?? "").replace(/[$,\s]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`"${input}" is not a valid amount`);
  return Math.round(Number(s) * 100);
}

export function slugify(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export function list(input: FormDataEntryValue | null): string[] {
  return String(input ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export const cad = (c: number | null | undefined) =>
  c == null ? "—" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(c / 100);

export function describeRule(r: VariantDetail["rule"]): string {
  if (!r) return "No pricing rule";
  const pct = (x: number) => `${+(x * 100).toFixed(2)}%`;
  return `${pct(Number(r.rate))} ${r.rule_type} (${r.scope} rule)` +
    (Number(r.min_profit_cents) ? `, min ${cad(Number(r.min_profit_cents))} profit` : "") +
    (r.rounding === "charm_99" ? ", rounded to .99" : "");
}

/** Turns a database error into something a person can act on. */
export function friendly(message: string): string {
  if (/product_variants_sku_key/.test(message)) return "That SKU is already used by another variant.";
  if (/products_slug_key/.test(message)) return "That web address (slug) is already used by another product.";
  if (/categories_slug_key/.test(message)) return "That web address (slug) is already used by another category.";
  if (/slug_check|_slug_check/.test(message)) return "The web address may only use lowercase letters, numbers and dashes.";
  if (/sku_check/.test(message)) return "SKUs use capital letters, numbers and dashes (2–40 characters).";
  if (/outer_bigger_than_inner/.test(message)) return "The outer case must hold more units than the inner pack.";
  if (/inner_qty_check|outer_qty_check/.test(message)) return "Pack sizes must be 2 or more units.";
  if (/variant_barcodes_code_key/.test(message)) return "That barcode is already used by another item.";
  if (/permission (\S+) required/.test(message)) return `Your role doesn't allow this (${message.match(/permission (\S+) required/)![1]}).`;
  return message;
}
