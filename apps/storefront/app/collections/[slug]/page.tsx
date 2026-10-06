import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Listing } from "@/components/listing";
import { collectionProductIds, listCollections, listProducts } from "@/lib/catalog";
import { parseSort, sortProducts } from "@/lib/listing";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ sort?: string }> };

async function find(slug: string) {
  if (!supabaseConfigured()) return null;
  return (await listCollections()).find((c) => c.slug === slug) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await find((await params).slug);
  if (!c) return {};
  return { title: c.seo_title ?? c.name, description: c.seo_description ?? c.description ?? undefined, alternates: { canonical: `/collections/${c.slug}` } };
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const c = await find((await params).slug);
  if (!c) notFound();
  const sort = parseSort((await searchParams).sort);
  const [ids, all] = await Promise.all([collectionProductIds(c.id), listProducts()]);
  const products = sortProducts(ids.map((id) => all.find((p) => p.id === id)).filter((p) => p !== undefined), sort);
  return (
    <Listing title={c.name} intro={c.description} sort={sort} products={products}
             crumbs={[{ name: "Home", path: "/" }, { name: "Shop", path: "/shop" }, { name: c.name, path: `/collections/${c.slug}` }]} />
  );
}
