import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Listing } from "@/components/listing";
import { listProducts } from "@/lib/catalog";
import { occasionBySlug } from "@/lib/discovery";
import { applyFilter, parseSort, sortProducts } from "@/lib/listing";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ sort?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const o = occasionBySlug((await params).slug);
  if (!o) return {};
  return { title: `${o.title} in Canada`, description: o.intro, alternates: { canonical: `/occasions/${o.slug}` } };
}

export default async function OccasionPage({ params, searchParams }: Props) {
  const o = occasionBySlug((await params).slug);
  if (!o) notFound();
  const sort = parseSort((await searchParams).sort);
  const products = supabaseConfigured() ? sortProducts(applyFilter(await listProducts(), { occasion: o.slug }), sort) : [];
  return (
    <Listing title={o.title} intro={o.intro} faq={o.faq} sort={sort} products={products}
             crumbs={[{ name: "Home", path: "/" }, { name: "Occasions", path: "/occasions" }, { name: o.name, path: `/occasions/${o.slug}` }]} />
  );
}
