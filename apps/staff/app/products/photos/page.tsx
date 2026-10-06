import Link from "next/link";
import { BulkPhotos } from "@/components/bulk-photos";
import { requireStaff } from "@/lib/auth";

export const metadata = { title: "Upload photos" };
export const dynamic = "force-dynamic";

export default async function PhotosPage() {
  await requireStaff("catalog.edit");
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <p className="text-sm text-muted"><Link href="/products" className="hover:underline">Products</Link> /</p>
        <h1 className="text-2xl font-semibold">Upload photos in bulk</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">Photos are matched to products by item number. Uploading the same folder again skips photos that are already there.</p>
      </div>
      <BulkPhotos />
    </div>
  );
}
