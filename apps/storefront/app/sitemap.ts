import type { MetadataRoute } from "next";
import { listProducts } from "@/lib/catalog";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const home = { url: site, changeFrequency: "daily" as const, priority: 1 };
  if (!supabaseConfigured()) return [home];
  const products = await listProducts();
  return [
    home,
    ...products.map((p) => ({ url: `${site}/products/${p.slug}`, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
