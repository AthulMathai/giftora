import Link from "next/link";
import type { ReactNode } from "react";
import type { Product } from "@/lib/catalog";
import type { Faq } from "@/lib/discovery";
import { SORTS, type Sort } from "@/lib/listing";
import { breadcrumbLd, faqLd, itemListLd, type Crumb } from "@/lib/seo";
import { JsonLd } from "./json-ld";
import { ProductCard } from "./product-card";

/** Shared layout for every gift listing: category, occasion, recipient, budget, season, collection. */
export function Listing({ title, intro, crumbs, products, faq = [], sort, banner, children, empty, hiddenParams = {} }: {
  title: string;
  intro?: string | null;
  crumbs: Crumb[];
  products: Product[];
  faq?: Faq[];
  sort: Sort;
  banner?: ReactNode;
  children?: ReactNode;          // extra controls under the heading (filters)
  empty?: ReactNode;
  hiddenParams?: Record<string, string | undefined>;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
      <JsonLd data={[breadcrumbLd(crumbs), itemListLd(title, products), faqLd(faq)]} />
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <ol className="flex flex-wrap gap-1">
          {crumbs.map((c, i) => (
            <li key={c.path} className="flex gap-1">
              {i > 0 && <span aria-hidden>/</span>}
              {i < crumbs.length - 1
                ? <Link href={c.path} className="hover:text-coral">{c.name}</Link>
                : <span aria-current="page" className="text-ink">{c.name}</span>}
            </li>
          ))}
        </ol>
      </nav>

      {banner ?? (
        <header className="mt-6 max-w-2xl">
          <h1 className="font-display text-4xl sm:text-5xl tracking-tight">{title}</h1>
          {intro && <p className="mt-4 text-lg text-muted">{intro}</p>}
        </header>
      )}

      {children}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
        <p className="text-sm text-muted">{products.length} {products.length === 1 ? "gift" : "gifts"}</p>
        {products.length > 1 && (
          <form className="flex items-center gap-2 text-sm">
            {Object.entries(hiddenParams).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
            <label htmlFor="sort" className="text-muted">Sort</label>
            <select id="sort" name="sort" defaultValue={sort} className="h-10 rounded-full border border-line bg-paper px-3">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button className="h-10 rounded-full border border-line px-4 hover:border-ink">Apply</button>
          </form>
        )}
      </div>

      {products.length === 0 ? (
        <div className="py-16 text-muted">{empty ?? <p>No gifts here yet. <Link href="/shop" className="underline">Browse all gifts</Link>.</p>}</div>
      ) : (
        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-10">
          {products.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
        </div>
      )}

      {faq.length > 0 && (
        <section className="mt-20 max-w-3xl" aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="font-display text-3xl">Good to know</h2>
          <dl className="mt-6 divide-y divide-line border-y border-line">
            {faq.map((f) => (
              <div key={f.q} className="py-5">
                <dt className="font-medium">{f.q}</dt>
                <dd className="mt-2 text-muted leading-relaxed">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

export function Chip({ href, active, children }: { href: string; active?: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "true" : undefined}
          className={`shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm transition ${active ? "border-ink bg-ink text-cream" : "border-line bg-paper hover:border-ink"}`}>
      {children}
    </Link>
  );
}
