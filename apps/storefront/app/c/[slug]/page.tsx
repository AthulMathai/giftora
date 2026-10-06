import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Listing } from "@/components/listing";
import { listCategories, listProducts } from "@/lib/catalog";
import { applyFilter, parseSort, sortProducts } from "@/lib/listing";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ sort?: string }> };

async function find(slug: string) {
  if (!supabaseConfigured()) return null;
  return (await listCategories()).find((c) => c.slug === slug) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await find((await params).slug);
  if (!c) return {};
  return {
    title: c.seo_title ?? `${c.name} gifts`,
    description: c.seo_description ?? c.description ?? `${c.name} gifts, hand-checked and shipped across Canada.`,
    alternates: { canonical: `/c/${c.slug}` },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const c = await find((await params).slug);
  if (!c) notFound();
  const sort = parseSort((await searchParams).sort);
  const products = sortProducts(applyFilter(await listProducts(), { category: c.slug }), sort);
  return (
    <Listing title={c.name} intro={c.description} sort={sort} products={products}
             crumbs={[{ name: "Home", path: "/" }, { name: "Shop", path: "/shop" }, { name: c.name, path: `/c/${c.slug}` }]} />
  );
}
