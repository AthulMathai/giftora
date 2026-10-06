import { type Product, minPrice } from "./catalog";
import { recipientBySlug } from "./discovery";

export type Sort = "featured" | "newest" | "price-asc" | "price-desc";
export const SORTS: { value: Sort; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
];

export function parseSort(s: string | undefined): Sort {
  return SORTS.some((x) => x.value === s) ? (s as Sort) : "featured";
}

export interface Filter {
  occasion?: string;
  recipient?: string;
  category?: string;    // category slug
  minCents?: number;
  maxCents?: number;
}

export function applyFilter(products: Product[], f: Filter): Product[] {
  const who = f.recipient ? recipientBySlug(f.recipient)?.match ?? [f.recipient] : null;
  return products.filter((p) => {
    if (f.occasion && !p.occasions.includes(f.occasion)) return false;
    if (who && !p.recipients.some((r) => who.includes(r))) return false;
    if (f.category && p.category?.slug !== f.category) return false;
    const price = minPrice(p);
    if (f.maxCents !== undefined && (price === null || price > f.maxCents)) return false;
    if (f.minCents !== undefined && (price === null || price < f.minCents)) return false;
    return true;
  });
}

/** listProducts() already returns newest first, so "featured" and "newest" keep that order. */
export function sortProducts(products: Product[], sort: Sort): Product[] {
  const by = (dir: 1 | -1) => [...products].sort((a, b) => ((minPrice(a) ?? 0) - (minPrice(b) ?? 0)) * dir);
  if (sort === "price-asc") return by(1);
  if (sort === "price-desc") return by(-1);
  return products;
}
