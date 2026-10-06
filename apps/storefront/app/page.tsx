import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { ProductCard } from "@/components/product-card";
import { SeasonSection } from "@/components/season";
import { SetupNotice } from "@/components/setup-notice";
import { activeCampaigns, campaignProducts } from "@/lib/campaigns";
import { listCategories, listProducts } from "@/lib/catalog";
import { BUDGETS, OCCASIONS, RECIPIENTS } from "@/lib/discovery";
import { itemListLd } from "@/lib/seo";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { alternates: { canonical: "/" } };

export default async function HomePage() {
  const configured = supabaseConfigured();
  const products = configured ? await listProducts() : null;
  const categories = configured ? await listCategories() : [];
  const seasons = await activeCampaigns();
  const seasonBlocks = products
    ? await Promise.all(seasons.slice(0, 2).map(async (c) => ({ c, items: await campaignProducts(c, products) })))
    : [];

  return (
    <>
      {products && <JsonLd data={itemListLd("New gifts at Giftora", products.slice(0, 12))} />}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-14 pb-6 sm:pt-20">
        <p className="text-sm uppercase tracking-[0.18em] text-coral">Gifts, thoughtfully found</p>
        <h1 className="mt-4 font-display text-5xl sm:text-7xl leading-[1.02] tracking-tight max-w-3xl">
          Gifts they&apos;ll actually keep.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Hand-picked presents for every person on your list, checked by hand and shipped across Canada.
        </p>
        <form action="/shop" role="search" className="mt-8 flex max-w-xl gap-2">
          <label htmlFor="home-q" className="sr-only">Describe who you&apos;re shopping for</label>
          <input id="home-q" name="q" placeholder="“Birthday gift for my sister who loves coffee, under $50”"
                 className="h-12 flex-1 rounded-full border border-line bg-paper px-5 outline-none focus:border-ink" />
          <button className="h-12 rounded-full bg-ink px-6 text-cream hover:bg-coral">Find gifts</button>
        </form>
        <ul className="mt-6 flex flex-wrap gap-2" aria-label="Shop by occasion">
          {OCCASIONS.slice(0, 6).map((o) => (
            <li key={o.slug}>
              <Link href={`/occasions/${o.slug}`} className="block rounded-full border border-line bg-paper px-4 py-2 text-sm hover:border-ink">{o.name}</Link>
            </li>
          ))}
          <li><Link href="/occasions" className="block px-2 py-2 text-sm underline underline-offset-4">More ideas</Link></li>
        </ul>
      </section>

      {seasonBlocks.map(({ c, items }) => <SeasonSection key={c.slug} c={c} products={items} />)}

      <section className="mx-auto max-w-6xl px-4 sm:px-6 mt-16 grid gap-4 sm:grid-cols-2">
        <div className="rounded-3xl border border-line bg-paper p-6">
          <h2 className="font-display text-2xl">Who are you shopping for?</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {RECIPIENTS.map((r) => (
              <li key={r.slug}><Link href={`/gifts-for/${r.slug}`} className="block rounded-full bg-cream px-4 py-2 text-sm hover:bg-ink hover:text-cream">{r.name}</Link></li>
            ))}
          </ul>
        </div>
        <div className="rounded-3xl border border-line bg-paper p-6">
          <h2 className="font-display text-2xl">Shop by budget</h2>
          <ul className="mt-4 grid grid-cols-2 gap-2">
            {BUDGETS.map((b) => (
              <li key={b}><Link href={`/gifts-under/${b}`} className="block rounded-2xl bg-cream px-4 py-3 text-center hover:bg-ink hover:text-cream">Under ${b}</Link></li>
            ))}
          </ul>
        </div>
      </section>

      <section id="shop" className="mx-auto max-w-6xl px-4 sm:px-6 mt-16">
        <div className="flex items-baseline justify-between border-t border-line pt-8">
          <h2 className="font-display text-3xl">New gifts</h2>
          {products && <Link href="/shop" className="text-sm underline underline-offset-4 hover:text-coral">Shop all {products.length} gifts</Link>}
        </div>
        {categories.length > 0 && (
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="Shop by type">
            {categories.map((c) => (
              <li key={c.slug}><Link href={`/c/${c.slug}`} className="block rounded-full border border-line px-4 py-2 text-sm hover:border-ink">{c.name}</Link></li>
            ))}
          </ul>
        )}
        {products === null ? (
          <SetupNotice />
        ) : products.length === 0 ? (
          <p className="py-16 text-muted">New gifts are on their way. Check back soon.</p>
        ) : (
          <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-10">
            {products.slice(0, 12).map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
          </div>
        )}
      </section>

      <section className="mx-auto max-w-6xl px-4 sm:px-6 mt-20 grid gap-6 sm:grid-cols-3 text-sm">
        {[
          ["Checked by hand", "Every gift is inspected and packed by our team before it ships."],
          ["Shipped across Canada", "Standard shipping is free over $75. Express is available at checkout."],
          ["Track every step", "Follow your order from packed to delivered in your account."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl bg-paper p-5 border border-line">
            <h3 className="font-medium">{t}</h3>
            <p className="mt-1 text-muted">{d}</p>
          </div>
        ))}
      </section>
    </>
  );
}
