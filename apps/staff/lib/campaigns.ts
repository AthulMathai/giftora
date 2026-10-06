import "server-only";
import { createAdminClient } from "./supabase/admin";

export const THEMES = [
  ["christmas", "Christmas"], ["halloween", "Halloween"], ["valentines", "Valentine's Day"], ["easter", "Easter"],
  ["mothers_day", "Mother's Day"], ["fathers_day", "Father's Day"], ["black_friday", "Black Friday"],
  ["new_year", "New Year"], ["back_to_school", "Back to school"], ["winter", "Winter"], ["spring", "Spring"],
  ["summer", "Summer"], ["autumn", "Autumn"], ["custom", "Custom"],
] as const;
export const THEME_LABEL: Record<string, string> = Object.fromEntries(THEMES);

export type Phase = "upcoming" | "early" | "live" | "ended";
export const PHASE: Record<Phase, { label: string; style: string }> = {
  live: { label: "Live now", style: "bg-ok/10 text-ok" },
  early: { label: "Shop early", style: "bg-accent/10 text-accent" },
  upcoming: { label: "Scheduled", style: "bg-warn/10 text-warn" },
  ended: { label: "Ended", style: "bg-line text-muted" },
};

export interface Campaign {
  id: string; slug: string; name: string; theme: string; occasion: string | null;
  eyebrow: string | null; headline: string; subheadline: string | null; body: string | null; early_message: string | null;
  cta_label: string; accent_color: string; background_color: string; ink_color: string;
  early_from: string | null; starts_at: string; ends_at: string; restyle_site: boolean; priority: number;
  is_published: boolean; seo_title: string | null; seo_description: string | null;
  faq: { q: string; a: string }[]; created_at: string; updated_at: string;
  phase: Phase; product_count: number; pinned?: string[];
}

export interface PickableProduct { id: string; name: string; status: string; occasions: string[] }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createAdminClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const listCampaigns = (actor: string) => rpc<Campaign[]>("svc_campaigns", { p_actor: actor });
export const getCampaign = (actor: string, id: string) => rpc<Campaign | null>("svc_campaign_get", { p_actor: actor, p_id: id });

/** Live products for the "hand-picked extras" list, plus any pinned ones that are no longer on sale. */
export async function pickableProducts(pinned: string[] = []): Promise<PickableProduct[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("products").select("id,name,status,occasions")
    .in("status", ["active", "seasonal"]).order("name");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PickableProduct[];
  const missing = pinned.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) {
    const { data: extra } = await admin.from("products").select("id,name,status,occasions").in("id", missing);
    rows.push(...((extra ?? []) as PickableProduct[]));
  }
  return rows;
}

/** Turns a database error into something a person can act on. */
export function friendlyCampaignError(message: string): string {
  if (/campaigns_slug_key/.test(message)) return "That web address is already used by another campaign.";
  if (/slug_check/.test(message)) return "The web address may only use lowercase letters, numbers and dashes.";
  if (/occasion_check/.test(message)) return "The occasion tag may only use lowercase letters, numbers and dashes, like mothers-day.";
  if (/campaign_dates/.test(message)) return "The end must be after the start, and “Shop early from” must be on or before the start.";
  if (/_color_check/.test(message)) return "Colours must look like #d9533b.";
  if (/name_check/.test(message)) return "The name must be 2–80 characters.";
  if (/permission (\S+) required/.test(message)) return `Your role doesn't allow this (${message.match(/permission (\S+) required/)![1]}).`;
  return message;
}
