import Link from "next/link";
import Image from "next/image";
import type { Product } from "@/lib/catalog";
import { prices } from "@/lib/catalog";
import { priceRange } from "@/lib/format";

const TINTS = ["from-[#f3d9c9] to-[#e9b9a4]", "from-[#dfe6d3] to-[#b9c9b0]", "from-[#eadcef] to-[#cdb4d6]", "from-[#f6e6bf] to-[#e8c987]"];

export function ProductCard({ product, index }: { product: Product; index: number }) {
  const image = [...product.product_images].sort((a, b) => a.sort_order - b.sort_order)[0];
  return (
    <Link href={`/products/${product.slug}`} className="group block">
      <div className={`relative aspect-[4/5] overflow-hidden rounded-2xl bg-linear-to-br ${TINTS[index % TINTS.length]}`}>
        {image ? (
          <Image src={image.url} alt={image.alt_text} fill sizes="(min-width: 1024px) 25vw, 50vw"
                 className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <span aria-hidden className="absolute inset-0 grid place-items-center font-display text-7xl text-ink/25">
            {product.name.charAt(0)}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium leading-snug group-hover:text-coral">{product.name}</h3>
          {product.category && <p className="text-sm text-muted">{product.category.name}</p>}
        </div>
        <p className="text-sm whitespace-nowrap">{priceRange(prices(product))}</p>
      </div>
    </Link>
  );
}
