import type { MetadataRoute } from "next";
import { getCampaigns } from "@/lib/campaigns";
import { listCategories, listCollections, listProducts } from "@/lib/catalog";
import { BUDGETS, OCCASIONS, RECIPIENTS } from "@/lib/discovery";
import { siteUrl } from "@/lib/seo";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Entry = MetadataRoute.Sitemap[number];
const e = (path: string, priority: number, changeFrequency: Entry["changeFrequency"] = "weekly", lastModified?: string): Entry =>
  ({ url: siteUrl(path), priority, changeFrequency, ...(lastModified ? { lastModified } : {}) });

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fixed: Entry[] = [
    e("/", 1, "daily"), e("/shop", 0.9, "daily"), e("/occasions", 0.7), e("/seasons", 0.7),
    e("/faq", 0.4, "monthly"), e("/about", 0.3, "monthly"), e("/shipping-returns", 0.4, "monthly"), e("/privacy", 0.2, "yearly"),
    ...OCCASIONS.map((o) => e(`/occasions/${o.slug}`, 0.7)),
    ...RECIPIENTS.map((r) => e(`/gifts-for/${r.slug}`, 0.6)),
    ...BUDGETS.map((b) => e(`/gifts-under/${b}`, 0.6)),
  ];
  if (!supabaseConfigured()) return fixed;
  const [products, categories, collections, campaigns] = await Promise.all([listProducts(), listCategories(), listCollections(), getCampaigns()]);
  return [
    ...fixed,
    ...categories.map((c) => e(`/c/${c.slug}`, 0.7)),
    ...collections.map((c) => e(`/collections/${c.slug}`, 0.6)),
    ...campaigns.map((c) => e(`/seasons/${c.slug}`, c.phase === "live" || c.phase === "early" ? 0.9 : 0.5)),
    ...products.map((p) => e(`/products/${p.slug}`, 0.8)),
  ];
}
