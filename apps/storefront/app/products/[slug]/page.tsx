import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductGallery } from "@/components/product-gallery";
import { SetupNotice } from "@/components/setup-notice";
import { Alert, SubmitButton } from "@/components/ui";
import { addToCart } from "@/app/cart/actions";
import { getUser } from "@/lib/auth";
import { getAvailability, getProduct, prices } from "@/lib/catalog";
import { formatCad, priceRange } from "@/lib/format";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> };

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

export default async function ProductPage({ params, searchParams }: Props) {
  const { error } = await searchParams;
  if (!supabaseConfigured()) return <SetupNotice />;
  const product = await getProduct((await params).slug);
  if (!product) notFound();

  const variants = [...product.product_variants].filter((v) => v.price_cents !== null);
  const availability = await getAvailability(variants.map((v) => v.id));
  const purchasable = product.status === "active" || product.status === "seasonal";
  const anyInStock = variants.some((v) => (availability.get(v.id) ?? 0) > 0);
  const firstAvailable = variants.find((v) => (availability.get(v.id) ?? 0) > 0);
  const user = await getUser();
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
        <ProductGallery images={[...product.product_images].sort((a, b) => a.sort_order - b.sort_order)} name={product.name} />

        <div>
          <h1 className="font-display text-4xl sm:text-5xl tracking-tight">{product.name}</h1>
          <p className="mt-3 text-xl">{priceRange(prices(product))}</p>
          {product.description && <p className="mt-6 text-muted leading-relaxed">{product.description}</p>}

          {error === "unavailable" && <div className="mt-6"><Alert>That option just sold out. Please pick another.</Alert></div>}

          {purchasable && anyInStock ? (
            <form action={addToCart} className="mt-8">
              <input type="hidden" name="back" value={`/products/${product.slug}`} />
              {variants.length > 1 ? (
                <fieldset>
                  <legend className="text-sm font-medium">{product.option_names.join(" / ") || "Option"}</legend>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {variants.map((v) => {
                      const qty = availability.get(v.id) ?? 0;
                      return (
                        <label key={v.id}
                          className={`relative cursor-pointer rounded-xl border px-3 py-2 text-sm has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-cream ${qty > 0 ? "border-line bg-paper" : "cursor-not-allowed border-line/60 text-muted line-through"}`}>
                          <input type="radio" name="variant_id" value={v.id} required disabled={qty === 0}
                                 defaultChecked={v.id === firstAvailable?.id} className="sr-only" />
                          <span className="block">{v.label}</span>
                          <span className="text-xs opacity-75">{formatCad(v.price_cents ?? 0)}{qty > 0 && qty <= 3 ? ` · only ${qty} left` : ""}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : (
                <input type="hidden" name="variant_id" value={firstAvailable?.id} />
              )}
              <div className="mt-6 flex items-center gap-3">
                <label className="sr-only" htmlFor="quantity">Quantity</label>
                <select id="quantity" name="quantity" defaultValue="1"
                        className="h-12 rounded-full border border-line bg-paper px-4">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <SubmitButton className="flex-1 sm:flex-none">{user ? "Add to cart" : "Sign in to add to cart"}</SubmitButton>
              </div>
            </form>
          ) : (
            <p className="mt-8 text-muted">Currently unavailable</p>
          )}

          <div>
            <p className="mt-4 text-sm text-muted">Ships across Canada in 3–7 business days. Free standard shipping over $75.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
