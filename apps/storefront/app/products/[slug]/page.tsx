import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { getAvailability, getProduct, prices } from "@/lib/catalog";
import { formatCad, priceRange } from "@/lib/format";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!supabaseConfigured()) return {};
  const product = await getProduct((await params).slug);
  if (!product) return {};
  const description = product.seo_description ?? product.description ?? undefined;
  return {
    title: product.seo_title ?? product.name,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: { title: product.name, description },
  };
}

export default async function ProductPage({ params }: Props) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const product = await getProduct((await params).slug);
  if (!product) notFound();

  const variants = [...product.product_variants].filter((v) => v.price_cents !== null);
  const availability = await getAvailability(variants.map((v) => v.id));
  const purchasable = product.status === "active" || product.status === "seasonal";
  const anyInStock = variants.some((v) => (availability.get(v.id) ?? 0) > 0);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  // Product structured data for search engines and AI answer engines.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description ?? undefined,
    sku: variants.length === 1 ? variants[0]?.sku : undefined,
    category: product.category?.name,
    image: product.product_images.map((i) => i.url),
    brand: { "@type": "Brand", name: "Giftora" },
    offers: variants.map((v) => ({
      "@type": "Offer",
      sku: v.sku,
      name: v.label,
      priceCurrency: "CAD",
      price: ((v.price_cents ?? 0) / 100).toFixed(2),
      availability: purchasable && (availability.get(v.id) ?? 0) > 0
        ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: `${siteUrl}/products/${product.slug}`,
    })),
  };

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/" className="hover:text-coral">Home</Link>
        {product.category && <> / <span>{product.category.name}</span></>}
      </nav>

      <div className="mt-6 grid gap-10 md:grid-cols-2">
        <div className="aspect-square rounded-3xl bg-linear-to-br from-[#f3d9c9] to-[#e9b9a4] grid place-items-center">
          <span aria-hidden className="font-display text-9xl text-ink/20">{product.name.charAt(0)}</span>
        </div>

        <div>
          <h1 className="font-display text-4xl sm:text-5xl tracking-tight">{product.name}</h1>
          <p className="mt-3 text-xl">{priceRange(prices(product))}</p>
          {product.description && <p className="mt-6 text-muted leading-relaxed">{product.description}</p>}

          {variants.length > 1 && (
            <fieldset className="mt-8">
              <legend className="text-sm font-medium">{product.option_names.join(" / ") || "Option"}</legend>
              <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {variants.map((v) => {
                  const qty = availability.get(v.id) ?? 0;
                  return (
                    <li key={v.id} className={`rounded-xl border px-3 py-2 text-sm ${qty > 0 ? "border-line bg-paper" : "border-line/60 text-muted line-through"}`}>
                      <span className="block">{v.label}</span>
                      <span className="text-xs text-muted">{formatCad(v.price_cents ?? 0)}{qty > 0 && qty <= 3 ? ` · only ${qty} left` : ""}</span>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          <div className="mt-8">
            {purchasable && anyInStock ? (
              <span className="inline-flex h-12 items-center rounded-full bg-ink px-8 text-cream">
                Sign in to add to cart
              </span>
            ) : (
              <p className="text-muted">Currently unavailable</p>
            )}
            <p className="mt-3 text-sm text-muted">Ships across Canada in 3–7 business days. Free standard shipping over $75.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
