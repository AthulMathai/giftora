import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { cad, dateTime, staffOrders } from "@/lib/orders";
import { updateStatus } from "./actions";

export const metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "open", label: "Open", statuses: ["paid", "processing"] },
  { key: "paid", label: "New", statuses: ["paid"] },
  { key: "processing", label: "Being prepared", statuses: ["processing"] },
  { key: "shipped", label: "Shipped", statuses: ["shipped"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
] as const;

const BADGE: Record<string, string> = {
  paid: "bg-accent/10 text-accent", processing: "bg-warn/10 text-warn",
  shipped: "bg-ok/10 text-ok", delivered: "bg-ok/10 text-ok",
};

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string }> }) {
  const staff = await requireStaff("orders.view");
  const { status = "open", error } = await searchParams;
  const filter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const orders = await staffOrders(staff.userId, [...filter.statuses]);
  const canEdit = staff.can("orders.edit");
  const back = `/orders?status=${filter.key}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <nav className="flex gap-1 rounded-lg border border-line bg-panel p-1 text-sm">
          {FILTERS.map((f) => (
            <Link key={f.key} href={`/orders?status=${f.key}`}
                  className={`rounded-md px-3 py-1.5 ${f.key === filter.key ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
              {f.label}
            </Link>
          ))}
        </nav>
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-bad/40 bg-bad/5 px-4 py-3 text-sm text-bad">{error}</p>}

      {orders.length === 0 ? (
        <p className="mt-10 text-sm text-muted">No orders here.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {orders.map((o) => {
            const a = o.shipping_address;
            return (
              <article key={o.id} className="rounded-xl border border-line bg-panel p-5">
                <header className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-3">
                    <h2 className="text-lg font-semibold">{o.order_number}</h2>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[o.status] ?? "bg-line"}`}>{o.status}</span>
                    {o.ship_by && o.status === "paid" && <span className="text-xs text-muted">ship by {o.ship_by}</span>}
                  </div>
                  <div className="text-sm">
                    {cad(o.total_cents)}
                    {o.profit_cents != null && <span className="ml-3 text-ok">profit {cad(o.profit_cents)}</span>}
                  </div>
                </header>

                <div className="mt-4 grid gap-6 md:grid-cols-[1fr_260px]">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted">
                      <tr><th className="pb-1 font-normal">SKU</th><th className="pb-1 font-normal">Item</th><th className="pb-1 text-right font-normal">Qty</th><th className="pb-1 text-right font-normal">Price</th>{o.items[0]?.unit_cost_cents !== undefined && <th className="pb-1 text-right font-normal">Cost</th>}</tr>
                    </thead>
                    <tbody>
                      {o.items.map((i) => (
                        <tr key={i.sku} className="border-t border-line">
                          <td className="py-1.5 font-mono text-xs">{i.sku}</td>
                          <td className="py-1.5">{i.product} <span className="text-muted">— {i.variant}</span></td>
                          <td className="py-1.5 text-right font-semibold">{i.quantity}</td>
                          <td className="py-1.5 text-right">{cad(i.unit_price_cents)}</td>
                          {i.unit_cost_cents !== undefined && <td className="py-1.5 text-right text-muted">{cad(i.unit_cost_cents)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="text-sm">
                    <p className="font-medium">{a.full_name}</p>
                    <p className="text-muted">{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.city}, {a.province} {a.postal_code}{a.phone ? <><br />{a.phone}</> : null}</p>
                    <p className="mt-1 text-muted">{o.email} · {o.shipping_method_name}</p>
                    <p className="mt-1 text-xs text-muted">Paid {dateTime(o.paid_at)}</p>
                    {o.tracking_number && <p className="mt-1 text-xs">{o.carrier} <span className="font-mono">{o.tracking_number}</span></p>}
                  </div>
                </div>

                {canEdit && (o.status === "paid" || o.status === "processing") && (
                  <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-line pt-4">
                    {o.status === "paid" && (
                      <form action={updateStatus}>
                        <input type="hidden" name="order_id" value={o.id} />
                        <input type="hidden" name="status" value="processing" />
                        <input type="hidden" name="back" value={back} />
                        <button className="h-9 rounded-lg border border-line px-3 text-sm hover:border-ink">Items acquired — preparing</button>
                      </form>
                    )}
                    <form action={updateStatus} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="order_id" value={o.id} />
                      <input type="hidden" name="status" value="shipped" />
                      <input type="hidden" name="back" value={back} />
                      <label className="text-xs text-muted">Carrier
                        <select name="carrier" required className="mt-1 block h-9 rounded-lg border border-line px-2 text-sm text-ink">
                          <option>Canada Post</option><option>Purolator</option><option>UPS</option><option>FedEx</option>
                        </select>
                      </label>
                      <label className="text-xs text-muted">Tracking number
                        <input name="tracking_number" required className="mt-1 block h-9 w-56 rounded-lg border border-line px-2 font-mono text-sm text-ink" />
                      </label>
                      <button className="h-9 rounded-lg bg-ink px-4 text-sm text-white">Mark shipped</button>
                    </form>
                  </div>
                )}
                {canEdit && o.status === "shipped" && (
                  <form action={updateStatus} className="mt-5 border-t border-line pt-4">
                    <input type="hidden" name="order_id" value={o.id} />
                    <input type="hidden" name="status" value="delivered" />
                    <input type="hidden" name="back" value={back} />
                    <button className="h-9 rounded-lg border border-line px-3 text-sm hover:border-ink">Mark delivered</button>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
