import { ProductCard } from "@/components/product-card";
import { SetupNotice } from "@/components/setup-notice";
import { listProducts } from "@/lib/catalog";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const OCCASIONS = ["Birthday", "Christmas", "Housewarming", "Thank you", "Just because"];

export default async function HomePage() {
  const products = supabaseConfigured() ? await listProducts() : null;

  return (
    <>
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-16 pb-12 sm:pt-24">
        <p className="text-sm uppercase tracking-[0.18em] text-coral">Gifts, thoughtfully found</p>
        <h1 className="mt-4 font-display text-5xl sm:text-7xl leading-[1.02] tracking-tight max-w-3xl">
          Gifts they&apos;ll actually keep.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Hand-picked presents for every person on your list, checked by hand and shipped across Canada.
        </p>
        <ul className="mt-8 flex flex-wrap gap-2" aria-label="Shop by occasion">
          {OCCASIONS.map((o) => (
            <li key={o} className="rounded-full border border-line bg-paper px-4 py-2 text-sm">{o}</li>
          ))}
        </ul>
      </section>

      <section id="shop" className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex items-baseline justify-between border-t border-line pt-8">
          <h2 className="font-display text-3xl">All gifts</h2>
          {products && <p className="text-sm text-muted">{products.length} gifts</p>}
        </div>
        {products === null ? (
          <SetupNotice />
        ) : products.length === 0 ? (
          <p className="py-16 text-muted">New gifts are on their way. Check back soon.</p>
        ) : (
          <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-10">
            {products.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
          </div>
        )}
      </section>
    </>
  );
}
