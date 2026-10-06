import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, Panel } from "@/components/form";
import { PhotoUploader } from "@/components/photo-uploader";
import { ProductForm } from "@/components/product-form";
import { VariantForm } from "@/components/variant-form";
import { requireStaff } from "@/lib/auth";
import { getProduct, getVariantPacks, listCategories } from "@/lib/catalog";
import { deletePhoto, makePhotoFirst } from "../actions";

export const metadata = { title: "Edit product" };
export const dynamic = "force-dynamic";

export default async function EditProductPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const staff = await requireStaff("catalog.view");
  const { id } = await params;
  const { error, saved } = await searchParams;
  const [product, categories] = await Promise.all([getProduct(staff.userId, id), listCategories(staff.userId)]);
  if (!product) notFound();
  if (staff.can("suppliers.view")) {
    const packs = await getVariantPacks(staff.userId, product.id);
    for (const v of product.variants) Object.assign(v, packs[v.id] ?? {});
  }

  const canEdit = staff.can("catalog.edit");
  const canSupply = staff.can("suppliers.edit");
  const canFinance = staff.can("finance.view");
  const store = process.env.STOREFRONT_URL;
  const live = ["active", "seasonal", "out_of_stock", "acquisition_unavailable", "archived"].includes(product.status);
  const sellable = product.variants.filter((v) => v.is_active && v.price_cents != null);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/products" className="text-sm text-muted hover:text-ink">← Products</Link>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold">{product.name}</h1>
          {store && live && (
            <a href={`${store}/products/${product.slug}`} target="_blank" rel="noopener noreferrer" className="text-sm underline">View in store ↗</a>
          )}
        </div>
      </div>

      {error && <Notice tone="bad">{error}</Notice>}
      {saved && !error && <Notice tone="ok">{saved === "variant" ? "Variant saved. Price updated from cost." : "Product saved."}</Notice>}
      {product.status === "active" && sellable.length === 0 && (
        <Notice tone="warn">This product is set to Active but has no variant with a price, so customers can&apos;t buy it. Add a variant with a supplier cost below.</Notice>
      )}

      <Panel title="Details"><ProductForm product={product} categories={categories} canEdit={canEdit} /></Panel>

      <Panel title="Photos">
        {product.images.length > 0 && (
          <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {product.images.map((img, i) => (
              <li key={img.id} className="overflow-hidden rounded-lg border border-line bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.alt_text} className="aspect-square w-full object-cover" />
                {canEdit && (
                  <div className="flex items-center justify-between gap-2 p-2 text-xs">
                    {i === 0 ? <span className="text-muted">Main photo</span> : (
                      <form action={makePhotoFirst}>
                        <input type="hidden" name="product_id" value={product.id} />
                        <input type="hidden" name="image_id" value={img.id} />
                        <button className="underline">Make main</button>
                      </form>
                    )}
                    <form action={deletePhoto}>
                      <input type="hidden" name="product_id" value={product.id} />
                      <input type="hidden" name="image_id" value={img.id} />
                      <button className="text-bad">Delete</button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? <PhotoUploader productId={product.id} productName={product.name} /> : product.images.length === 0 && <p className="text-sm text-muted">No photos.</p>}
      </Panel>

      <section id="variants" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Variants</h2>
          <p className="text-xs text-muted">Each variant is one SKU. Prices are calculated from supplier cost by your pricing rules.</p>
        </div>
        {product.variants.map((v) => (
          <VariantForm key={v.id} productId={product.id} optionNames={product.option_names} variant={v}
                       canEdit={canEdit} canSupply={canSupply} canFinance={canFinance} />
        ))}
        {canEdit && (
          <details open={product.variants.length === 0} className="rounded-xl border border-line bg-panel p-4">
            <summary className="cursor-pointer text-sm font-medium">Add a variant</summary>
            <div className="mt-4">
              <VariantForm productId={product.id} optionNames={product.option_names}
                           canEdit={canEdit} canSupply={canSupply} canFinance={canFinance} />
            </div>
          </details>
        )}
        {!canSupply && canEdit && <p className="text-xs text-muted">Your role can&apos;t set supplier cost; an inventory manager must add it before a variant can be priced.</p>}
      </section>
    </div>
  );
}
