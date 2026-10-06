import Link from "next/link";
import { ImportWizard } from "@/components/import-wizard";
import { aiConfigured } from "@/lib/ai";
import { requireStaff } from "@/lib/auth";

export const metadata = { title: "Import products" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireStaff("catalog.edit");
  await requireStaff("suppliers.edit");
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <p className="text-sm text-muted"><Link href="/products" className="hover:underline">Products</Link> /</p>
        <h1 className="text-2xl font-semibold">Import from a spreadsheet</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Upload the supplier sheet (item numbers, names, costs, locations, barcodes, packs). New item numbers become products; ones
          already here get updated. Nothing is ever deleted, and you see every change before it&apos;s saved. Upload a newer sheet any time.
        </p>
      </div>
      <ImportWizard aiName={aiConfigured()} />
    </div>
  );
}
