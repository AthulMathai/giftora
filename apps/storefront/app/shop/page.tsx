import type { Metadata } from "next";
import Link from "next/link";
import { Chip, Listing } from "@/components/listing";
import { SetupNotice } from "@/components/setup-notice";
import { TrackSearch } from "@/components/tracker";
import { listCategories, listProducts, searchProductIds } from "@/lib/catalog";
import { BUDGETS, OCCASIONS, RECIPIENTS, occasionBySlug, parseGiftQuery, recipientBySlug } from "@/lib/discovery";
import { formatCad } from "@/lib/format";
import { applyFilter, parseSort, sortProducts } from "@/lib/listing";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { q?: string; occasion?: string; for?: string; category?: string; max?: string; min?: string; sort?: string };

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const p = await searchParams;
  const filtered = Object.values(p).some(Boolean);
  return {
    title: p.q ? `Search: ${p.q}` : "Shop all gifts",
    description: "Browse every Giftora gift by occasion, recipient and budget. Shipped across Canada.",
    alternates: { canonical: "/shop" },
    // Filtered and search result pages shouldn't compete with the real landing pages.
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

function href(p: Params, change: Partial<Params>) {
  const next = { ...p, ...change };
  const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
  return qs ? `/shop?${qs}` : "/shop";
}

export default async function ShopPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  if (!supabaseConfigured()) return <SetupNotice />;

  const q = (p.q ?? "").trim().slice(0, 200);
  const intent = q ? parseGiftQuery(q) : { terms: "" };
  const occasion = p.occasion ?? intent.occasion;
  const recipient = p.for ?? intent.recipient;
  const maxCents = p.max ? Number(p.max) * 100 : intent.maxCents;
  const minCents = p.min ? Number(p.min) * 100 : intent.minCents;
  const sort = parseSort(p.sort);

  const [all, categories] = await Promise.all([listProducts(), listCategories()]);
  let products = applyFilter(all, { occasion, recipient, category: p.category, maxCents, minCents });
  if (intent.terms) {
    const ranked = await searchProductIds(intent.terms);
    const pos = new Map(ranked.map((id, i) => [id, i]));
    products = products.filter((x) => pos.has(x.id));
    if (sort === "featured") products.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
  }
  products = sortProducts(products, sort);

  const understood = [
    occasion && occasionBySlug(occasion)?.name,
    recipient && recipientBySlug(recipient)?.name.toLowerCase(),
    minCents !== undefined && maxCents !== undefined ? `${formatCad(minCents)}–${formatCad(maxCents)}`
      : maxCents !== undefined ? `under ${formatCad(maxCents)}` : null,
    intent.terms && `“${intent.terms}”`,
  ].filter(Boolean);

  return (
    <Listing
      title={q ? "Search results" : "All gifts"}
      intro={q ? null : "Every gift in the shop. Narrow it down by occasion, who it's for, or budget."}
      crumbs={[{ name: "Home", path: "/" }, { name: "Shop", path: "/shop" }]}
      products={products}
      sort={sort}
      hiddenParams={{ q: p.q, occasion: p.occasion, for: p.for, category: p.category, max: p.max, min: p.min }}
      empty={<p>Nothing matched{q ? ` “${q}”` : ""}. Try fewer words, or <Link href="/shop" className="underline">browse all gifts</Link>.</p>}
    >
      {q && <TrackSearch query={q} results={products.length} />}
      <form action="/shop" role="search" className="mt-6 flex max-w-2xl gap-2">
        <label htmlFor="shop-q" className="sr-only">Search gifts</label>
        <input id="shop-q" name="q" defaultValue={q} placeholder="Try “birthday gift for my sister under $50”"
               className="h-12 flex-1 rounded-full border border-line bg-paper px-5 outline-none focus:border-ink" />
        <button className="h-12 rounded-full bg-ink px-6 text-cream hover:bg-coral">Search</button>
      </form>
      {q && understood.length > 0 && (
        <p className="mt-3 text-sm text-muted">Showing {understood.join(" · ")}</p>
      )}

      <div className="mt-6 space-y-3">
        <FilterRow label="Occasion">
          <Chip href={href(p, { occasion: undefined })} active={!occasion}>Any</Chip>
          {OCCASIONS.map((o) => <Chip key={o.slug} href={href(p, { occasion: o.slug })} active={occasion === o.slug}>{o.name}</Chip>)}
        </FilterRow>
        <FilterRow label="For">
          <Chip href={href(p, { for: undefined })} active={!recipient}>Anyone</Chip>
          {RECIPIENTS.map((r) => <Chip key={r.slug} href={href(p, { for: r.slug })} active={recipient === r.slug}>{r.name}</Chip>)}
        </FilterRow>
        <FilterRow label="Budget">
          <Chip href={href(p, { max: undefined, min: undefined })} active={maxCents === undefined}>Any</Chip>
          {BUDGETS.map((b) => <Chip key={b} href={href(p, { max: String(b), min: undefined })} active={maxCents === b * 100 && minCents === undefined}>Under ${b}</Chip>)}
        </FilterRow>
        {categories.length > 0 && (
          <FilterRow label="Type">
            <Chip href={href(p, { category: undefined })} active={!p.category}>All</Chip>
            {categories.map((c) => <Chip key={c.slug} href={href(p, { category: c.slug })} active={p.category === c.slug}>{c.name}</Chip>)}
          </FilterRow>
        )}
      </div>
    </Listing>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-16 shrink-0 pt-2 text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">{children}</div>
    </div>
  );
}
