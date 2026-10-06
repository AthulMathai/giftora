import { requireStaff } from "@/lib/auth";
import { pickSummary } from "@/lib/orders";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Pick list" };
export const dynamic = "force-dynamic";

export default async function PickListPage() {
  const staff = await requireStaff("fulfillment.operate");
  const lines = await pickSummary(staff.userId);
  const units = lines.reduce((s, l) => s + Number(l.total_qty), 0);
  const generated = new Intl.DateTimeFormat("en-CA", { dateStyle: "full", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date());

  return (
    <div className="print:text-black">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Pick list</h1>
          <p className="mt-1 text-sm text-muted">
            Everything paid and not yet acquired · {lines.length} SKUs · {units} units · {generated}
          </p>
        </div>
        <PrintButton />
      </div>

      {lines.length === 0 ? (
        <p className="mt-10 text-sm text-muted">Nothing to acquire right now.</p>
      ) : (
        <table className="mt-6 w-full border-collapse bg-panel text-sm">
          <thead>
            <tr className="border-b-2 border-ink text-left">
              <th className="w-10 p-2">✓</th>
              <th className="p-2">Aisle</th>
              <th className="p-2">SKU</th>
              <th className="p-2">Item</th>
              <th className="p-2 text-right">Qty</th>
              <th className="p-2">For orders</th>
              <th className="p-2 print:w-40">Notes</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.sku} className="border-b border-line align-top">
                <td className="p-2"><span className="inline-block size-5 rounded border-2 border-ink" /></td>
                <td className="p-2 font-mono">{l.aisle ?? "—"}</td>
                <td className="p-2 font-mono font-semibold">{l.sku}</td>
                <td className="p-2">{l.product}<span className="block text-xs text-muted">{l.variant}{l.supplier ? ` · ${l.supplier}` : ""}</span></td>
                <td className="p-2 text-right text-xl font-bold">{l.total_qty}</td>
                <td className="p-2 text-xs text-muted">{l.orders.join(", ")}</td>
                <td className="p-2" />
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-6 text-xs text-muted print:block">Short or damaged? Write it in Notes and tell the order manager before packing.</p>
    </div>
  );
}
