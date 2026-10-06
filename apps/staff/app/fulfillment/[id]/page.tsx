import Link from "next/link";
import { notFound } from "next/navigation";
import { updateStatus } from "@/app/orders/actions";
import { Button, Input, Notice, Panel } from "@/components/form";
import { PrintButton } from "@/components/print-button";
import { Scanner } from "@/components/scanner";
import { requireStaff } from "@/lib/auth";
import { getSession, SESSION_STEPS } from "@/lib/fulfillment";
import { dateTime } from "@/lib/orders";
import { closeSession, overridePack, packScan, removeFromSession, sortScan, updatePick } from "../actions";

export const metadata = { title: "Fulfillment session" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "pick", label: "1 · Pick" },
  { key: "sort", label: "2 · Sort" },
  { key: "pack", label: "3 · Pack & ship" },
  { key: "orders", label: "Orders & bins" },
] as const;

export default async function SessionPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; order?: string; error?: string }>;
}) {
  const staff = await requireStaff("fulfillment.operate");
  const { id } = await params;
  const { tab = "pick", order: orderParam, error } = await searchParams;
  const s = await getSession(staff.userId, id);
  if (!s) notFound();

  const active = s.orders.filter((o) => !o.removed);
  const units = s.pick_lines.reduce((t, l) => t + l.required, 0);
  const picked = s.pick_lines.reduce((t, l) => t + l.picked, 0);
  const sortedUnits = active.flatMap((o) => o.items).reduce((t, i) => t + i.sorted, 0);
  const totalUnits = active.flatMap((o) => o.items).reduce((t, i) => t + i.quantity, 0);
  const done = (st: string) => active.filter((o) => o.status === st).length;
  const stepIndex = SESSION_STEPS.indexOf(s.status as (typeof SESSION_STEPS)[number]);
  const openExceptions = s.exceptions.filter((e) => e.status === "open");

  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <Link href="/fulfillment" className="text-sm text-muted hover:text-ink">← Fulfillment</Link>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold"><span className="font-mono">{s.code}</span> <span className="text-base font-normal text-muted">· {active.length} orders · {units} units</span></h1>
          <ol className="flex gap-1 text-xs">
            {SESSION_STEPS.map((step, i) => (
              <li key={step} className={`rounded-full px-2.5 py-1 ${i < stepIndex ? "bg-ok/10 text-ok" : i === stepIndex ? "bg-ink text-white" : "bg-line text-muted"}`}>{step}</li>
            ))}
          </ol>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <Stat label="Picked" value={`${picked}/${units}`} />
          <Stat label="Sorted" value={`${sortedUnits}/${totalUnits}`} />
          <Stat label="Ready to pack" value={done("ready_to_ship")} />
          <Stat label="Packed" value={done("packed")} />
          <Stat label="Shipped" value={`${done("shipped") + done("delivered")}/${active.length}`} />
        </div>
        {error && <div className="mt-3"><Notice tone="bad">{error}</Notice></div>}
        {openExceptions.length > 0 && (
          <div className="mt-3"><Notice tone="warn">{openExceptions.length} open exception{openExceptions.length === 1 ? "" : "s"} in this session. <Link href="/exceptions" className="underline">Review</Link></Notice></div>
        )}
        <nav className="mt-4 flex gap-1 border-b border-line">
          {TABS.map((t) => (
            <Link key={t.key} href={`/fulfillment/${s.id}?tab=${t.key}`}
                  className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t.key ? "border-ink font-semibold" : "border-transparent text-muted hover:text-ink"}`}>
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {tab === "pick" && (
        <div>
          <div className="hidden print:block">
            <h1 className="text-xl font-bold">Pick list {s.code}</h1>
            <p className="text-sm">Orders paid {s.date_from}{s.date_to !== s.date_from ? ` to ${s.date_to}` : ""} · {active.length} orders · {units} units · Picker: ____________</p>
          </div>
          <div className="mb-3 flex items-center justify-between print:hidden">
            <p className="text-sm text-muted">Take this list to the supplier. Record what you got; anything short opens an exception.</p>
            <PrintButton />
          </div>
          <table className="w-full rounded-xl border border-line bg-panel text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="p-2 font-normal">✓</th><th className="p-2 font-normal">Aisle</th><th className="p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">Item</th><th className="p-2 text-right font-normal">Need</th>
                <th className="p-2 font-normal print:hidden">Got / Short / Damaged</th><th className="hidden p-2 font-normal print:table-cell">Notes</th>
              </tr>
            </thead>
            <tbody>
              {s.pick_lines.map((l) => {
                const resolved = l.picked + l.short >= l.required;
                return (
                  <tr key={l.id} className={`border-t border-line align-top ${resolved ? (l.short ? "bg-warn/5" : "bg-ok/5") : ""}`}>
                    <td className="p-2"><span className={`inline-grid size-5 place-items-center rounded border-2 border-ink text-xs ${resolved && !l.short ? "bg-ink text-white" : ""}`}>{resolved && !l.short ? "✓" : ""}</span></td>
                    <td className="p-2 font-mono">{l.aisle ?? "—"}</td>
                    <td className="p-2 font-mono font-semibold">{l.sku}{l.barcode && <span className="block text-[10px] font-normal text-muted">{l.barcode}</span>}</td>
                    <td className="p-2">{l.product}<span className="block text-xs text-muted">{l.variant}</span></td>
                    <td className="p-2 text-right text-xl font-bold">{l.required}</td>
                    <td className="p-2 print:hidden">
                      <form action={updatePick} className="flex flex-wrap items-center gap-1">
                        <input type="hidden" name="session_id" value={s.id} />
                        <input type="hidden" name="pick_line_id" value={l.id} />
                        <input name="picked" defaultValue={resolved ? l.picked : l.required} inputMode="numeric" aria-label="Got" className="h-8 w-14 rounded-md border border-line px-2" />
                        <input name="short" defaultValue={l.short} inputMode="numeric" aria-label="Short" className="h-8 w-14 rounded-md border border-line px-2" />
                        <input name="damaged" defaultValue={l.damaged} inputMode="numeric" aria-label="Damaged" className="h-8 w-14 rounded-md border border-line px-2" />
                        <input name="notes" defaultValue={l.notes ?? ""} placeholder="Notes" className="h-8 w-32 rounded-md border border-line px-2" />
                        <button className="h-8 rounded-md bg-ink px-3 text-xs text-white">{resolved ? "Update" : "Save"}</button>
                      </form>
                    </td>
                    <td className="hidden p-2 print:table-cell" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "sort" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Scanner mode="sort" scan={sortScan.bind(null, s.id)} />
          <Panel title="Bins">
            <ul className="space-y-1 text-sm">
              {active.map((o) => {
                const q = o.items.reduce((t, i) => t + i.quantity, 0);
                const so = o.items.reduce((t, i) => t + i.sorted, 0);
                return (
                  <li key={o.order_id} className="flex items-center justify-between">
                    <span><span className="font-mono font-semibold">{o.bin}</span> <span className="text-muted">{o.order_number}</span></span>
                    <span className={so === q ? "font-semibold text-ok" : ""}>{so}/{q}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      )}

      {tab === "pack" && <PackTab session={s} orderId={orderParam} canOverride={staff.can("fulfillment.override")} canShip={staff.can("orders.edit")} />}

      {tab === "orders" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between print:hidden">
            <p className="text-sm text-muted">Print this sheet and tape each slip to its bin.</p>
            <div className="flex gap-2">
              <PrintButton />
              {s.status !== "completed" && (
                <form action={closeSession}><input type="hidden" name="session_id" value={s.id} /><Button variant="secondary">Close session</Button></form>
              )}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2">
            {s.orders.map((o) => (
              <div key={o.order_id} className={`break-inside-avoid rounded-xl border-2 p-4 ${o.removed ? "border-dashed border-line opacity-60" : "border-ink"}`}>
                <div className="flex items-baseline justify-between">
                  <p className="text-3xl font-bold">{o.bin ?? "—"}</p>
                  <p className="font-mono">{o.order_number}</p>
                </div>
                <p className="text-sm">{o.customer} · {o.shipping_method}</p>
                <ul className="mt-2 text-sm">
                  {o.items.map((i) => <li key={i.order_item_id}><span className="font-mono">{i.sku}</span> × {i.quantity} <span className="text-muted print:hidden">({i.sorted} sorted)</span></li>)}
                </ul>
                <p className="mt-2 text-xs text-muted print:hidden">{o.removed ? "Removed from session" : o.status.replace(/_/g, " ")}{o.tracking_number ? ` · ${o.carrier} ${o.tracking_number}` : ""}</p>
                {!o.removed && !["shipped", "delivered"].includes(o.status) && (
                  <form action={removeFromSession} className="mt-2 flex gap-2 print:hidden">
                    <input type="hidden" name="session_id" value={s.id} />
                    <input type="hidden" name="order_id" value={o.order_id} />
                    <input name="reason" placeholder="Reason" required className="h-8 flex-1 rounded-md border border-line px-2 text-xs" />
                    <button className="text-xs text-bad">Remove</button>
                  </form>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted print:hidden">Started {dateTime(s.created_at)}{s.created_by ? ` by ${s.created_by}` : ""}.</p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function PackTab({ session: s, orderId, canOverride, canShip }: {
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>; orderId?: string; canOverride: boolean; canShip: boolean;
}) {
  const packable = s.orders.filter((o) => !o.removed && ["processing", "ready_to_ship", "packed"].includes(o.status));
  const current = packable.find((o) => o.order_id === orderId);

  if (!current) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">Pick the bin you&apos;re packing. Only fully sorted orders can be packed.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {packable.map((o) => (
            <Link key={o.order_id} href={`/fulfillment/${s.id}?tab=pack&order=${o.order_id}`}
                  className={`rounded-xl border-2 p-4 ${o.status === "ready_to_ship" ? "border-ink" : o.status === "packed" ? "border-ok" : "border-line opacity-60"}`}>
              <p className="text-3xl font-bold">{o.bin}</p>
              <p className="font-mono text-sm">{o.order_number}</p>
              <p className="text-xs text-muted">{o.status === "processing" ? "Still sorting" : o.status === "packed" ? "Packed — needs tracking" : "Ready to pack"}</p>
            </Link>
          ))}
          {packable.length === 0 && <p className="text-sm text-muted">Nothing left to pack in this session.</p>}
        </div>
      </div>
    );
  }

  const back = `/fulfillment/${s.id}?tab=pack&order=${current.order_id}`;
  return (
    <div className="space-y-5">
      <Link href={`/fulfillment/${s.id}?tab=pack`} className="text-sm text-muted hover:text-ink">← All bins</Link>
      <div className="flex flex-wrap items-baseline gap-4">
        <p className="text-5xl font-bold">{current.bin}</p>
        <div><p className="font-mono text-lg">{current.order_number}</p><p className="text-sm text-muted">{current.customer} · {current.shipping_method}</p></div>
      </div>

      <table className="w-full max-w-2xl text-sm">
        <thead className="text-left text-xs text-muted"><tr><th className="pb-1 font-normal">SKU</th><th className="pb-1 font-normal">Item</th><th className="pb-1 text-right font-normal">Expected</th><th className="pb-1 text-right font-normal">Scanned</th></tr></thead>
        <tbody>
          {current.items.map((i) => (
            <tr key={i.order_item_id} className={`border-t border-line ${i.packed >= i.quantity ? "text-ok" : ""}`}>
              <td className="py-1.5 font-mono">{i.sku}</td><td className="py-1.5">{i.product} — {i.variant}</td>
              <td className="py-1.5 text-right font-semibold">{i.quantity}</td><td className="py-1.5 text-right font-semibold">{i.packed}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {current.status === "ready_to_ship" && <Scanner mode="pack" scan={packScan.bind(null, current.order_id)} />}
      {current.status === "processing" && <Notice tone="warn">This order isn&apos;t fully sorted yet. Finish sorting first.</Notice>}

      {current.status === "packed" && canShip && (
        <Panel title="Ship it">
          <form action={updateStatus} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="order_id" value={current.order_id} />
            <input type="hidden" name="status" value="shipped" />
            <input type="hidden" name="back" value={back} />
            <label className="text-xs font-medium text-muted">Carrier
              <select name="carrier" required className="mt-1 block h-9 rounded-lg border border-line px-2 text-sm text-ink">
                <option>Canada Post</option><option>Purolator</option><option>UPS</option><option>FedEx</option>
              </select>
            </label>
            <Input label="Tracking number" name="tracking_number" required className="w-64" />
            <Button>Mark shipped and email the customer</Button>
          </form>
        </Panel>
      )}

      {canOverride && ["processing", "ready_to_ship"].includes(current.status) && (
        <details className="max-w-2xl rounded-xl border border-bad/30 p-4">
          <summary className="cursor-pointer text-sm font-medium text-bad">Manager override (skip scan verification)</summary>
          <form action={overridePack} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="session_id" value={s.id} />
            <input type="hidden" name="order_id" value={current.order_id} />
            <Input label="Reason (saved in the audit log)" name="reason" required className="flex-1" placeholder="e.g. barcode label damaged, checked by eye" />
            <Button variant="danger">Override and mark packed</Button>
          </form>
        </details>
      )}
    </div>
  );
}
