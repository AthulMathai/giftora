import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { cad, listProducts, STATUS_HELP } from "@/lib/catalog";

export const metadata = { title: "Products" };
export const dynamic = "force-dynamic";

const BADGE: Record<string, string> = {
  active: "bg-ok/10 text-ok", seasonal: "bg-ok/10 text-ok", draft: "bg-line text-muted",
  paused: "bg-warn/10 text-warn", archived: "bg-line text-muted", discontinued: "bg-bad/10 text-bad",
  out_of_stock: "bg-warn/10 text-warn", acquisition_unavailable: "bg-warn/10 text-warn",
};

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const staff = await requireStaff("catalog.view");
  const { q = "", status = "" } = await searchParams;
  const all = await listProducts(staff.userId);
  const rows = all.filter((p) =>
    (!status || p.status === status) &&
    (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.slug.includes(q.toLowerCase())));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="mt-1 text-sm text-muted">{all.length} products · {all.filter((p) => p.status === "active").length} on sale</p>
        </div>
        {staff.can("catalog.edit") && (
          <div className="flex flex-wrap gap-2">
            <Link href="/products/import" className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm hover:border-ink">Import spreadsheet</Link>
            <Link href="/products/photos" className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm hover:border-ink">Upload photos</Link>
            <Link href="/products/new" className="inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm text-white">New product</Link>
          </div>
        )}
      </div>

      <form className="mt-6 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search by name" className="h-9 w-64 rounded-lg border border-line bg-white px-3 text-sm" />
        <select name="status" defaultValue={status} className="h-9 rounded-lg border border-line bg-white px-2 text-sm">
          <option value="">All statuses</option>
          {Object.keys(STATUS_HELP).map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <button className="h-9 rounded-lg border border-line bg-white px-3 text-sm">Filter</button>
      </form>

      {rows.length === 0 ? (
        <p className="mt-10 text-sm text-muted">{all.length === 0 ? "No products yet. Create your first one." : "No products match."}</p>
      ) : (
        <table className="mt-4 w-full overflow-hidden rounded-xl border border-line bg-panel text-sm">
          <thead className="bg-canvas text-left text-xs text-muted">
            <tr>
              <th className="p-3 font-normal" />
              <th className="p-3 font-normal">Product</th>
              <th className="p-3 font-normal">Status</th>
              <th className="p-3 font-normal">Category</th>
              <th className="p-3 text-right font-normal">Variants</th>
              <th className="p-3 text-right font-normal">Price</th>
              <th className="p-3 text-right font-normal">Can sell</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-line hover:bg-canvas/60">
                <td className="w-14 p-2">
                  {p.image_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.image_url} alt="" className="size-10 rounded-md object-cover" />
                    : <div className="grid size-10 place-items-center rounded-md bg-canvas text-muted">{p.name.charAt(0)}</div>}
                </td>
                <td className="p-3"><Link href={`/products/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td>
                <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs ${BADGE[p.status] ?? ""}`}>{p.status.replace(/_/g, " ")}</span></td>
                <td className="p-3 text-muted">{p.category ?? "—"}</td>
                <td className="p-3 text-right">{p.variants}</td>
                <td className="p-3 text-right">
                  {p.min_price_cents == null ? "—" : p.min_price_cents === p.max_price_cents ? cad(p.min_price_cents) : `${cad(p.min_price_cents)}–${cad(p.max_price_cents)}`}
                </td>
                <td className={`p-3 text-right ${p.available === 0 ? "text-bad" : ""}`}>{p.available}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
