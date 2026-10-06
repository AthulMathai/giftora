import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Listing } from "@/components/listing";
import { listProducts } from "@/lib/catalog";
import { BUDGETS } from "@/lib/discovery";
import { applyFilter, parseSort, sortProducts } from "@/lib/listing";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ amount: string }>; searchParams: Promise<{ sort?: string }> };

function budget(raw: string) {
  const n = Number(raw);
  return (BUDGETS as readonly number[]).includes(n) ? n : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const b = budget((await params).amount);
  if (!b) return {};
  return {
    title: `Gifts under $${b} in Canada`,
    description: `Thoughtful gifts under $${b} CAD for every occasion, shipped across Canada.`,
    alternates: { canonical: `/gifts-under/${b}` },
  };
}

export default async function BudgetPage({ params, searchParams }: Props) {
  const b = budget((await params).amount);
  if (!b) notFound();
  const sort = parseSort((await searchParams).sort);
  const products = supabaseConfigured() ? sortProducts(applyFilter(await listProducts(), { maxCents: b * 100 }), sort) : [];
  return (
    <Listing title={`Gifts under $${b}`} intro={`Every gift here is $${b} or less (CAD, before tax and shipping).`} sort={sort} products={products}
             faq={[{ q: `Do gifts under $${b} qualify for free shipping?`, a: "Standard shipping is free on orders over $75, so pairing two smaller gifts often gets you free shipping." }]}
             crumbs={[{ name: "Home", path: "/" }, { name: "Occasions", path: "/occasions" }, { name: `Under $${b}`, path: `/gifts-under/${b}` }]} />
  );
}
