import { cache } from "react";
import type { Faq } from "./discovery";
import { listProducts, type Product } from "./catalog";
import { createClient, supabaseConfigured } from "./supabase/server";

export type SeasonTheme =
  | "christmas" | "halloween" | "valentines" | "easter" | "mothers_day" | "fathers_day" | "black_friday"
  | "new_year" | "back_to_school" | "winter" | "spring" | "summer" | "autumn" | "custom";

export type Phase = "upcoming" | "early" | "live" | "ended";

export interface Campaign {
  id: string;
  slug: string;
  name: string;
  theme: SeasonTheme;
  occasion: string | null;
  eyebrow: string | null;
  headline: string;
  subheadline: string | null;
  body: string | null;
  early_message: string | null;
  cta_label: string;
  accent_color: string;
  background_color: string;
  ink_color: string;
  early_from: string | null;
  starts_at: string;
  ends_at: string;
  restyle_site: boolean;
  priority: number;
  seo_title: string | null;
  seo_description: string | null;
  faq: Faq[];
  phase: Phase;
}

export function phaseOf(c: Pick<Campaign, "early_from" | "starts_at" | "ends_at">, now = Date.now()): Phase {
  if (now >= Date.parse(c.ends_at)) return "ended";
  if (now >= Date.parse(c.starts_at)) return "live";
  if (c.early_from && now >= Date.parse(c.early_from)) return "early";
  return "upcoming";
}

/** Every published season (RLS hides drafts), with its phase right now. One query per request. */
export const getCampaigns = cache(async (): Promise<Campaign[]> => {
  if (!supabaseConfigured()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("campaigns")
    .select("id, slug, name, theme, occasion, eyebrow, headline, subheadline, body, early_message, cta_label, accent_color, background_color, ink_color, early_from, starts_at, ends_at, restyle_site, priority, seo_title, seo_description, faq")
    .order("priority", { ascending: false });
  if (error) {
    console.error("[campaigns]", error.message);
    return [];
  }
  return ((data ?? []) as unknown as Omit<Campaign, "phase">[]).map((c) => ({ ...c, faq: Array.isArray(c.faq) ? c.faq : [], phase: phaseOf(c) }));
});

/** Seasons to feature now: live ones first, then "shop early" ones, by priority. */
export async function activeCampaigns(): Promise<Campaign[]> {
  const all = await getCampaigns();
  const rank = (c: Campaign) => (c.phase === "live" ? 0 : 1);
  return all.filter((c) => c.phase === "live" || c.phase === "early")
    .sort((a, b) => rank(a) - rank(b) || b.priority - a.priority);
}

/** The live season that restyles the whole site (colours + ribbon), if any. */
export async function siteTheme(): Promise<Campaign | null> {
  return (await activeCampaigns()).find((c) => c.phase === "live" && c.restyle_site) ?? null;
}

export async function getCampaign(slug: string): Promise<Campaign | null> {
  return (await getCampaigns()).find((c) => c.slug === slug) ?? null;
}

/** Products in a season: everything tagged with its occasion, plus hand-picked ones first. */
export async function campaignProducts(c: Campaign, all?: Product[]): Promise<Product[]> {
  const products = all ?? await listProducts();
  const supabase = await createClient();
  const { data } = await supabase.from("campaign_products").select("product_id, sort_order")
    .eq("campaign_id", c.id).order("sort_order");
  const pinned = (data ?? []).map((r: { product_id: string }) => r.product_id);
  const picked = pinned.map((id) => products.find((p) => p.id === id)).filter((p): p is Product => !!p);
  const tagged = c.occasion ? products.filter((p) => p.occasions.includes(c.occasion!) && !pinned.includes(p.id)) : [];
  return [...picked, ...tagged];
}

const DATE = new Intl.DateTimeFormat("en-CA", { month: "long", day: "numeric", timeZone: "America/Toronto" });
export function seasonDates(c: Campaign): string {
  const end = new Date(Date.parse(c.ends_at) - 1);
  return `${DATE.format(new Date(c.starts_at))} – ${DATE.format(end)}`;
}
