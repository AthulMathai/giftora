import Link from "next/link";
import { Notice, Panel } from "@/components/form";
import { ProductForm } from "@/components/product-form";
import { requireStaff } from "@/lib/auth";
import { listCategories } from "@/lib/catalog";

export const metadata = { title: "New product" };
export const dynamic = "force-dynamic";

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const staff = await requireStaff("catalog.edit");
  const { error } = await searchParams;
  const categories = await listCategories(staff.userId);
  return (
    <div className="max-w-4xl">
      <Link href="/products" className="text-sm text-muted hover:text-ink">← Products</Link>
      <h1 className="mt-2 text-2xl font-semibold">New product</h1>
      <p className="mt-1 text-sm text-muted">Create the product first; you&apos;ll add variants, cost, stock and photos on the next screen.</p>
      {error && <div className="mt-4"><Notice tone="bad">{error}</Notice></div>}
      <div className="mt-6"><Panel><ProductForm categories={categories} canEdit /></Panel></div>
    </div>
  );
}
