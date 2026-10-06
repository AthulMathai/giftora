import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Listing } from "@/components/listing";
import { listProducts } from "@/lib/catalog";
import { recipientBySlug } from "@/lib/discovery";
import { applyFilter, parseSort, sortProducts } from "@/lib/listing";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ sort?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = recipientBySlug((await params).slug);
  if (!r) return {};
  return {
    title: `${r.title} — shipped across Canada`,
    description: `${r.title}: hand-picked ideas for every budget and occasion, checked by hand and shipped across Canada.`,
    alternates: { canonical: `/gifts-for/${r.slug}` },
  };
}

export default async function RecipientPage({ params, searchParams }: Props) {
  const r = recipientBySlug((await params).slug);
  if (!r) notFound();
  const sort = parseSort((await searchParams).sort);
  const products = supabaseConfigured() ? sortProducts(applyFilter(await listProducts(), { recipient: r.slug }), sort) : [];
  return (
    <Listing title={r.title} intro={`Hand-picked ideas ${r.name.toLowerCase()}, for every budget and occasion.`} sort={sort} products={products}
             crumbs={[{ name: "Home", path: "/" }, { name: "Occasions", path: "/occasions" }, { name: r.title, path: `/gifts-for/${r.slug}` }]} />
  );
}
