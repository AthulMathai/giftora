import Link from "next/link";
import type { Campaign } from "@/lib/campaigns";
import type { Product } from "@/lib/catalog";
import { ProductCard } from "./product-card";
import { SeasonArt } from "./season-art";
import { TrackCampaign } from "./tracker";

/** Big seasonal banner with the season's own art and colours. */
export function SeasonHero({ c, compact = false, headingLevel = "h2" }: { c: Campaign; compact?: boolean; headingLevel?: "h1" | "h2" }) {
  const H = headingLevel;
  const early = c.phase === "early";
  return (
    <section className="relative overflow-hidden rounded-[2rem]"
             style={{ background: c.background_color, color: c.ink_color }}>
      <SeasonArt theme={c.theme} accent={c.accent_color} ink={c.ink_color} bg={c.background_color}
                 className="pointer-events-none absolute inset-y-0 right-0 h-full w-full sm:w-[70%] opacity-35 sm:opacity-100" />
      <div className={`relative max-w-xl px-6 sm:px-10 ${compact ? "py-10" : "py-14 sm:py-20"}`}>
        <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: c.accent_color }}>
          {early ? `Shop early · ${c.name}` : c.eyebrow ?? c.name}
        </p>
        <H className={`mt-3 font-display tracking-tight leading-[1.04] ${compact ? "text-3xl sm:text-4xl" : "text-4xl sm:text-6xl"}`}>
          {c.headline}
        </H>
        {(early ? c.early_message ?? c.subheadline : c.subheadline) && (
          <p className="mt-4 text-base sm:text-lg opacity-80">{early ? c.early_message ?? c.subheadline : c.subheadline}</p>
        )}
        <Link href={`/seasons/${c.slug}`}
              className="mt-7 inline-flex h-12 items-center rounded-full px-6 text-sm font-medium text-white shadow-sm transition hover:brightness-110"
              style={{ background: c.accent_color }}>
          {c.cta_label} →
        </Link>
      </div>
    </section>
  );
}

/** Home-page block for a season: banner plus a row of its gifts. */
export function SeasonSection({ c, products }: { c: Campaign; products: Product[] }) {
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 mt-14" aria-label={c.name}>
      <TrackCampaign slug={c.slug} />
      <SeasonHero c={c} compact={c.phase === "early"} />
      {products.length > 0 && (
        <>
          <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-10">
            {products.slice(0, 4).map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
          </div>
          {products.length > 4 && (
            <p className="mt-6 text-right">
              <Link href={`/seasons/${c.slug}`} className="text-sm underline underline-offset-4 hover:text-coral">
                See all {products.length} {c.name} gifts
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
