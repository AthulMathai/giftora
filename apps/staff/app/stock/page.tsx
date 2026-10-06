import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Button, Notice } from "@/components/form";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateTime } from "@/lib/orders";

export const metadata = { title: "Stock check" };
export const dynamic = "force-dynamic";

interface StockRow {
  variant_id: string; sku: string; label: string; product: string; product_status: string; supplier: string | null;
  aisle_location: string | null; on_hand_qty: number | null; supply_status: string | null; last_checked_at: string | null;
  stale: boolean; reserved: number; available: number;
}

async function saveStock(formData: FormData) {
  "use server";
  const staff = await requireStaff("suppliers.edit");
  const ids = formData.getAll("variant_id").map(String);
  const rows = ids
    .filter((id) => formData.get(`check_${id}`) === "on")
    .map((id) => ({
      variant_id: id,
      on_hand_qty: String(formData.get(`qty_${id}`) ?? "").trim(),
      supply_status: String(formData.get(`status_${id}`) ?? "available"),
    }));
  if (rows.length === 0) redirect("/stock?error=" + encodeURIComponent("Tick at least one row to confirm."));
  const { data, error } = await createAdminClient().rpc("svc_stock_update", { p_actor: staff.userId, p_rows: rows });
  if (error) redirect("/stock?error=" + encodeURIComponent(error.message));
  revalidatePath("/stock");
  redirect(`/stock?saved=${data}`);
}

export default async function StockPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; show?: string }> }) {
  const staff = await requireStaff("suppliers.view");
  const { error, saved, show = "all" } = await searchParams;
  const { data } = await createAdminClient().rpc("svc_stock_list", { p_actor: staff.userId });
  const all = (data ?? []) as StockRow[];
  const rows = show === "stale" ? all.filter((r) => r.stale) : all;
  const stale = all.filter((r) => r.stale).length;
  const canEdit = staff.can("suppliers.edit");

  return (
    <div>
      <h1 className="text-2xl font-semibold">Stock check</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        After each supplier visit, enter what they have on the shelf and tick the rows you checked. Stock not confirmed for
        72 hours is treated as unavailable, so customers can&apos;t buy something that may be gone.
      </p>

      <div className="mt-4 space-y-3">
        {error && <Notice tone="bad">{error}</Notice>}
        {saved && <Notice tone="ok">Confirmed {saved} item{saved === "1" ? "" : "s"}. They&apos;re sellable for the next 72 hours.</Notice>}
        {stale > 0 && <Notice tone="warn">{stale} item{stale === 1 ? " is" : "s are"} stale and hidden from sale until checked.</Notice>}
      </div>

      <nav className="mt-4 flex gap-1 text-sm">
        <a href="/stock" className={`rounded-md px-3 py-1.5 ${show !== "stale" ? "bg-ink text-white" : "text-muted"}`}>All ({all.length})</a>
        <a href="/stock?show=stale" className={`rounded-md px-3 py-1.5 ${show === "stale" ? "bg-ink text-white" : "text-muted"}`}>Needs check ({stale})</a>
      </nav>

      <form action={saveStock} className="mt-3">
        <table className="w-full rounded-xl border border-line bg-panel text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="p-3 font-normal">✓</th>
              <th className="p-3 font-normal">Aisle</th>
              <th className="p-3 font-normal">SKU</th>
              <th className="p-3 font-normal">Item</th>
              <th className="p-3 font-normal">Supplier has</th>
              <th className="p-3 font-normal">Status</th>
              <th className="p-3 text-right font-normal">Held for orders</th>
              <th className="p-3 text-right font-normal">Can sell</th>
              <th className="p-3 font-normal">Last checked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.variant_id} className={`border-t border-line ${r.stale ? "bg-warn/5" : ""}`}>
                <td className="p-3">
                  <input type="hidden" name="variant_id" value={r.variant_id} />
                  <input type="checkbox" name={`check_${r.variant_id}`} disabled={!canEdit} className="size-4 accent-ink" aria-label={`Confirm ${r.sku}`} />
                </td>
                <td className="p-3 font-mono text-xs">{r.aisle_location ?? "—"}</td>
                <td className="p-3 font-mono text-xs font-semibold">{r.sku}</td>
                <td className="p-3">{r.product} <span className="text-muted">— {r.label}</span></td>
                <td className="p-3">
                  <input name={`qty_${r.variant_id}`} defaultValue={r.on_hand_qty ?? ""} inputMode="numeric" disabled={!canEdit}
                         className="h-8 w-20 rounded-md border border-line px-2" aria-label={`Units for ${r.sku}`} />
                </td>
                <td className="p-3">
                  <select name={`status_${r.variant_id}`} defaultValue={r.supply_status ?? "available"} disabled={!canEdit}
                          className="h-8 rounded-md border border-line px-1">
                    <option value="available">Available</option>
                    <option value="unavailable">Unavailable</option>
                    <option value="discontinued">Discontinued</option>
                  </select>
                </td>
                <td className="p-3 text-right">{r.reserved}</td>
                <td className={`p-3 text-right font-semibold ${r.available === 0 ? "text-bad" : ""}`}>{r.available}</td>
                <td className={`p-3 text-xs ${r.stale ? "text-warn" : "text-muted"}`}>{r.last_checked_at ? dateTime(r.last_checked_at) : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit && rows.length > 0 && (
          <div className="mt-4 flex items-center gap-3">
            <Button>Confirm ticked rows</Button>
            <span className="text-xs text-muted">Only ticked rows are saved and marked as checked now.</span>
          </div>
        )}
      </form>
    </div>
  );
}
