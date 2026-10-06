import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { cad, dateTime, staffOrders } from "@/lib/orders";
import { PAYMENT_LABEL, PAYMENT_METHODS, SOURCE_BADGE } from "@/lib/staff-orders";
import { cancelStaffOrder, markStaffOrderPaid, refundOrder, updateStatus } from "./actions";

export const metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "open", label: "Open", statuses: ["pending_payment", "paid", "processing", "ready_to_ship", "packed"] },
  { key: "unpaid", label: "Waiting for payment", statuses: ["pending_payment"] },
  { key: "paid", label: "New", statuses: ["paid"] },
  { key: "processing", label: "Being prepared", statuses: ["processing", "ready_to_ship", "packed"] },
  { key: "shipped", label: "Shipped", statuses: ["shipped"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
] as const;

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "waiting for payment", paid: "paid", processing: "processing", ready_to_ship: "ready to ship",
  packed: "packed", shipped: "shipped", delivered: "delivered", cancelled: "cancelled",
};

const BADGE: Record<string, string> = {
  pending_payment: "bg-warn/15 text-ink", paid: "bg-accent/10 text-accent", processing: "bg-warn/10 text-warn", ready_to_ship: "bg-warn/10 text-warn",
  packed: "bg-ok/10 text-ok", cancelled: "bg-line text-muted",
  shipped: "bg-ok/10 text-ok", delivered: "bg-ok/10 text-ok",
};

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{
  status?: string; error?: string; refunded?: string; manual?: string; created?: string; linked?: string; paid?: string; cancelled?: string;
}> }) {
  const staff = await requireStaff("orders.view");
  const { status = "open", error, refunded, manual, created, linked, paid, cancelled } = await searchParams;
  const canRefund = staff.can("refunds.create");
  const filter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  // Abandoned web checkouts are also "pending payment"; only unpaid orders staff entered belong here.
  const orders = (await staffOrders(staff.userId, [...filter.statuses]))
    .filter((o) => !(o.status === "pending_payment" && o.source === "web"));
  const canEdit = staff.can("orders.edit");
  const back = `/orders?status=${filter.key}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold">Orders</h1>
          {canEdit && (
            <Link href="/orders/new" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90">
              + New order
            </Link>
          )}
        </div>
        <nav className="flex gap-1 rounded-lg border border-line bg-panel p-1 text-sm">
          {FILTERS.map((f) => (
            <Link key={f.key} href={`/orders?status=${f.key}`}
                  className={`rounded-md px-3 py-1.5 ${f.key === filter.key ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
              {f.label}
            </Link>
          ))}
        </nav>
      </div>
      {created && (
        <p role="status" className="mt-4 rounded-lg border border-ok/40 bg-ok/5 px-4 py-3 text-sm text-ok">
          Order {created} created.{" "}
          {filter.key === "unpaid" ? "Its stock is held until you mark it paid or cancel it." : "It's in the queue with the other new orders."}
          {linked && " It's linked to the customer's Giftora account, so they'll see it there and get emails."}
        </p>
      )}
      {paid && <p role="status" className="mt-4 rounded-lg border border-ok/40 bg-ok/5 px-4 py-3 text-sm text-ok">{paid} is marked paid and is now in the queue.</p>}
      {cancelled && <p role="status" className="mt-4 rounded-lg border border-ok/40 bg-ok/5 px-4 py-3 text-sm text-ok">{cancelled} was cancelled and its stock released.</p>}
      {refunded && !manual && <p role="status" className="mt-4 rounded-lg border border-ok/40 bg-ok/5 px-4 py-3 text-sm text-ok">Refund issued for {refunded}. The customer will see it on their order.</p>}
      {refunded && manual && (
        <p role="status" className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          Refund recorded for {refunded}. <strong>This order wasn&apos;t paid online, so no money moved automatically</strong> —
          give the customer their money back by hand (cash or e-transfer).
        </p>
      )}
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
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[o.status] ?? "bg-line"}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${o.source === "web" ? "border-line text-muted" : "border-ink text-ink"}`}>
                      {SOURCE_BADGE[o.source] ?? o.source}
                    </span>
                    {o.batch && (
                      <Link href={`/fulfillment/${o.batch_id}`} className="rounded-full border border-ink px-2.5 py-0.5 font-mono text-xs hover:bg-ink hover:text-white">
                        {o.batch}{o.bin ? ` · ${o.bin}` : ""}
                      </Link>
                    )}
                    {o.payment_status !== "captured" && o.status !== "pending_payment" && <span className="rounded-full bg-line px-2.5 py-0.5 text-xs">{o.payment_status.replace(/_/g, " ")}</span>}
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
                    {o.shipping_method === "pickup" ? (
                      <p className="text-muted">Local pickup{a.phone ? <><br />{a.phone}</> : null}</p>
                    ) : (
                      <p className="text-muted">{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.city}, {a.province} {a.postal_code}{a.phone ? <><br />{a.phone}</> : null}</p>
                    )}
                    <p className="mt-1 text-muted">{[o.email, o.shipping_method_name].filter(Boolean).join(" · ")}</p>
                    <p className="mt-1 text-xs text-muted">
                      {o.paid_at ? <>Paid {dateTime(o.paid_at)}</> : <>Placed {dateTime(o.placed_at)} · not paid yet</>}
                      {o.payment_method && <> · {PAYMENT_LABEL[o.payment_method] ?? o.payment_method}</>}
                    </p>
                    {o.staff_note && <p className="mt-1 text-xs"><span className="text-muted">Note:</span> {o.staff_note}</p>}
                    {o.tracking_number && <p className="mt-1 text-xs">{o.carrier} <span className="font-mono">{o.tracking_number}</span></p>}
                  </div>
                </div>

                {canEdit && o.status === "pending_payment" && o.source !== "web" && (
                  <div className="mt-5 space-y-3 rounded-lg border border-warn/40 bg-warn/10 p-4">
                    <p className="text-sm font-medium">Waiting for payment — the stock is held for this customer until you mark it paid or cancel it.</p>
                    <form action={markStaffOrderPaid} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="order_id" value={o.id} />
                      <input type="hidden" name="order_number" value={o.order_number} />
                      <input type="hidden" name="back" value={back} />
                      <label className="text-xs text-muted">How they paid
                        <select name="method" required className="mt-1 block h-9 rounded-lg border border-line bg-white px-2 text-sm text-ink">
                          {PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                      <label className="text-xs text-muted">Reference (optional)
                        <input name="reference" placeholder="e-Transfer ref, receipt #" className="mt-1 block h-9 w-56 rounded-lg border border-line bg-white px-2 text-sm text-ink" />
                      </label>
                      <label className="text-xs text-muted">Card fee (optional)
                        <input name="fee" inputMode="decimal" placeholder="0.00" className="mt-1 block h-9 w-24 rounded-lg border border-line bg-white px-2 text-sm text-ink" />
                      </label>
                      <button className="h-9 rounded-lg bg-ink px-4 text-sm text-white">Mark paid ({cad(o.total_cents)})</button>
                    </form>
                    <details>
                      <summary className="cursor-pointer text-sm text-muted">Cancel order…</summary>
                      <form action={cancelStaffOrder} className="mt-2 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="order_id" value={o.id} />
                        <input type="hidden" name="order_number" value={o.order_number} />
                        <input type="hidden" name="back" value={back} />
                        <label className="flex-1 text-xs text-muted">Reason
                          <input name="reason" required placeholder="e.g. Customer changed their mind" className="mt-1 block h-9 w-full rounded-lg border border-line bg-white px-2 text-sm text-ink" />
                        </label>
                        <button className="h-9 rounded-lg border border-bad/40 bg-white px-3 text-sm text-bad">Cancel order and release stock</button>
                      </form>
                    </details>
                  </div>
                )}
                {canEdit && (o.status === "paid" || o.status === "processing" || o.status === "packed") && (
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
                        <select name="carrier" required defaultValue={o.shipping_method === "pickup" ? "Local pickup" : "Canada Post"}
                                className="mt-1 block h-9 rounded-lg border border-line px-2 text-sm text-ink">
                          <option>Canada Post</option><option>Purolator</option><option>UPS</option><option>FedEx</option><option>Local pickup</option>
                        </select>
                      </label>
                      <label className="text-xs text-muted">Tracking number (optional)
                        <input name="tracking_number" className="mt-1 block h-9 w-56 rounded-lg border border-line px-2 font-mono text-sm text-ink" />
                      </label>
                      <button className="h-9 rounded-lg bg-ink px-4 text-sm text-white">{o.shipping_method === "pickup" ? "Mark picked up" : "Mark shipped"}</button>
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
                {canRefund && ["captured", "partially_refunded"].includes(o.payment_status) && (
                  <details className="mt-4 border-t border-line pt-3">
                    <summary className="cursor-pointer text-sm text-muted">Refund…</summary>
                    <form action={refundOrder} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="order_id" value={o.id} />
                      <input type="hidden" name="back" value={back} />
                      <input type="hidden" name="nonce" value={crypto.randomUUID()} />
                      <label className="text-xs text-muted">Amount (CAD)
                        <input name="amount" required inputMode="decimal" placeholder={(o.total_cents / 100).toFixed(2)}
                               className="mt-1 block h-9 w-28 rounded-lg border border-line px-2 text-sm text-ink" />
                      </label>
                      <label className="flex-1 text-xs text-muted">Reason (the customer won&apos;t see this)
                        <input name="reason" required placeholder="e.g. Large out of stock at supplier"
                               className="mt-1 block h-9 w-full rounded-lg border border-line px-2 text-sm text-ink" />
                      </label>
                      {!["shipped", "delivered"].includes(o.status) && (
                        <label className="flex items-center gap-2 pb-2 text-xs"><input type="checkbox" name="cancel" className="accent-ink" /> Also cancel the order</label>
                      )}
                      <button className="h-9 rounded-lg border border-bad/40 px-3 text-sm text-bad">
                        {o.payment_method && o.payment_method !== "stripe" ? "Record refund" : "Refund through Stripe"}
                      </button>
                    </form>
                    {o.payment_method && o.payment_method !== "stripe" && (
                      <p className="mt-2 text-xs text-muted">
                        This order was paid by {PAYMENT_LABEL[o.payment_method] ?? o.payment_method}, not online. Recording the refund
                        updates the order and profit reports — you give the money back yourself (cash or e-transfer).
                      </p>
                    )}
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
