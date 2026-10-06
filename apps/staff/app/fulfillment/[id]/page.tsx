import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/form";
import { PrintButton } from "@/components/print-button";
import { Scanner } from "@/components/scanner";
import { requireStaff } from "@/lib/auth";
import { describePacks, getPickPacks, getSession } from "@/lib/fulfillment";
import { dateTime } from "@/lib/orders";
import { createAdminClient } from "@/lib/supabase/admin";
import { pickAll, removeFromSession, shipBatch, sortScan, updatePick } from "../actions";

export const metadata = { title: "Batch" };
export const dynamic = "force-dynamic";

export default async function BatchPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; shipped?: string }>;
}) {
  const staff = await requireStaff("fulfillment.operate");
  const { id } = await params;
  const { error, shipped } = await searchParams;
  const s = await getSession(staff.userId, id);
  if (!s) notFound();
  const [packs, labelsRes] = await Promise.all([
    getPickPacks(staff.userId, s.id),
    createAdminClient().rpc("svc_batch_labels", { p_actor: staff.userId, p_session_id: s.id }),
  ]);
  const labels = (labelsRes.data ?? {}) as Record<string, { printed_at: string | null; count: number }>;

  const orders = s.orders.filter((o) => !o.removed);
  const lines = s.pick_lines;
  const picked = lines.every((l) => l.picked + l.short >= l.required);
  const units = (o: (typeof orders)[number]) => o.items.reduce((t, i) => t + i.quantity, 0);
  const sortedUnits = (o: (typeof orders)[number]) => o.items.reduce((t, i) => t + Math.min(i.sorted, i.quantity), 0);
  const labelled = orders.filter((o) => o.status === "packed");
  const shippedCount = orders.filter((o) => ["shipped", "delivered"].includes(o.status)).length;
  const completeNoLabel = orders.filter((o) => o.status === "ready_to_ship");
  const done = s.status === "completed";
  const step = done ? 4 : !picked ? 1 : labelled.length + shippedCount < orders.length ? 2 : 3;

  return (
    <div className="space-y-6">
      {/* Printable pick list (only shows on paper) */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold">Batch {s.code} — pick list</h1>
        <p className="text-sm">{orders.length} orders · {lines.reduce((t, l) => t + l.required, 0)} units · Picker: ________________</p>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead><tr className="border-b-2 border-black text-left"><th className="p-1">✓</th><th className="p-1">Aisle</th><th className="p-1">SKU</th><th className="p-1">Item</th><th className="p-1">Pick</th><th className="p-1">Short</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-black/30 align-top">
                <td className="p-1">☐</td><td className="p-1 font-mono">{l.aisle ?? ""}</td><td className="p-1 font-mono font-bold">{l.sku}</td>
                <td className="p-1">{l.product} — {l.variant}</td><td className="p-1 font-bold">{describePacks(packs[l.id], l.required)}</td><td className="p-1">____</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-6 print:hidden">
        <div>
          <Link href="/fulfillment" className="text-sm text-muted hover:text-ink">← Batches</Link>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Batch</p>
              <h1 className="font-mono text-4xl font-bold">{s.code}</h1>
            </div>
            <p className="text-sm text-muted">{orders.length} orders · started {dateTime(s.created_at)}{s.created_by ? ` by ${s.created_by}` : ""}</p>
          </div>
          <ol className="mt-4 grid grid-cols-3 gap-2 text-sm">
            {["Pick", "Sort & label", "Hand to carrier"].map((label, i) => (
              <li key={label} className={`rounded-lg px-3 py-2 ${step > i + 1 ? "bg-ok/10 text-ok" : step === i + 1 ? "bg-ink text-white" : "bg-line text-muted"}`}>
                {step > i + 1 ? "✓ " : `${i + 1}. `}{label}
              </li>
            ))}
          </ol>
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        {shipped && <Notice tone="ok">{shipped} order{shipped === "1" ? "" : "s"} handed to the carrier. Customers have been notified.</Notice>}
        {done && <Notice tone="ok">This batch is finished.</Notice>}

        {/* 1. Pick */}
        <section className={`rounded-xl border bg-panel p-5 ${step === 1 ? "border-ink" : "border-line"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">1. Pick from the supplier</h2>
            <div className="flex gap-2">
              <PrintButton />
              {!picked && (
                <form action={pickAll}>
                  <input type="hidden" name="session_id" value={s.id} />
                  <button className="h-10 rounded-lg bg-ink px-4 text-sm text-white">Got everything</button>
                </form>
              )}
            </div>
          </div>
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="pb-2 font-normal">Aisle</th><th className="pb-2 font-normal">SKU</th><th className="pb-2 font-normal">Item</th><th className="pb-2 font-normal">Pick</th><th className="pb-2 font-normal" /></tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const resolved = l.picked + l.short >= l.required;
                return (
                  <tr key={l.id} className="border-t border-line align-top">
                    <td className="py-2 font-mono">{l.aisle ?? "—"}</td>
                    <td className="py-2 font-mono font-semibold">{l.sku}</td>
                    <td className="py-2">{l.product} <span className="text-muted">— {l.variant}</span></td>
                    <td className="py-2 font-semibold">{describePacks(packs[l.id], l.required)}</td>
                    <td className="py-2 text-right">
                      {resolved ? (
                        <span className={l.short ? "text-warn" : "text-ok"}>{l.short ? `${l.short} short` : "✓ Got it"}</span>
                      ) : (
                        <details className="inline-block text-left">
                          <summary className="cursor-pointer text-xs text-muted underline">Some missing?</summary>
                          <form action={updatePick} className="mt-2 flex items-center gap-2">
                            <input type="hidden" name="session_id" value={s.id} />
                            <input type="hidden" name="pick_line_id" value={l.id} />
                            <label className="text-xs">Got <input name="picked" defaultValue={l.required} inputMode="numeric" className="ml-1 h-8 w-14 rounded border border-line px-1" /></label>
                            <label className="text-xs">Short <input name="short" defaultValue={0} inputMode="numeric" className="ml-1 h-8 w-14 rounded border border-line px-1" /></label>
                            <button className="h-8 rounded bg-ink px-3 text-xs text-white">Save</button>
                          </form>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* 2. Sort & label */}
        <section className={`rounded-xl border bg-panel p-5 ${step === 2 ? "border-ink" : "border-line"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">2. Scan into bins — each bin&apos;s label prints when it&apos;s full</h2>
            {completeNoLabel.length > 0 && (
              <a href={`/labels/batch/${s.id}?only=unprinted`} target="_blank" rel="noreferrer" className="rounded-lg border border-ink px-4 py-2 text-sm">
                Print {completeNoLabel.length} missing label{completeNoLabel.length === 1 ? "" : "s"}
              </a>
            )}
          </div>
          {!done && picked && <div className="mt-4"><Scanner mode="sort" scan={sortScan.bind(null, s.id)} /></div>}
          {!picked && <p className="mt-2 text-sm text-muted">Finish step 1 first.</p>}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {orders.map((o) => {
              const u = units(o), so = sortedUnits(o);
              const state = ["shipped", "delivered"].includes(o.status) ? "shipped" : o.status === "packed" ? "labelled" : o.status === "ready_to_ship" ? "complete" : "sorting";
              return (
                <div key={o.order_id} className={`rounded-xl border-2 p-3 ${state === "sorting" ? "border-line" : state === "complete" ? "border-warn" : "border-ok"}`}>
                  <p className="text-2xl font-bold">{o.bin}</p>
                  <p className="font-mono text-xs">{o.order_number}</p>
                  <div className="mt-2 h-1.5 rounded bg-line"><div className="h-1.5 rounded bg-ok" style={{ width: `${u ? (so / u) * 100 : 0}%` }} /></div>
                  <p className="mt-1 text-xs text-muted">
                    {state === "sorting" && `${so} of ${u} items`}
                    {state === "complete" && "Full — label not printed"}
                    {state === "labelled" && `Labelled${(labels[o.order_id]?.count ?? 0) > 1 ? ` (${labels[o.order_id]?.count}×)` : ""}`}
                    {state === "shipped" && "Shipped"}
                  </p>
                  {state !== "sorting" && (
                    <a href={`/labels/${o.order_id}?print=1`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs underline">
                      {state === "complete" ? "Print label" : "Reprint label"}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* 3. Hand to carrier */}
        <section className={`rounded-xl border bg-panel p-5 ${step === 3 ? "border-ink" : "border-line"}`}>
          <h2 className="text-lg font-semibold">3. Hand to the carrier</h2>
          {labelled.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{shippedCount ? `${shippedCount} shipped.` : "Labelled bins will appear here."}</p>
          ) : (
            <form action={shipBatch} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="session_id" value={s.id} />
              <label className="text-xs font-medium text-muted">Carrier
                <select name="carrier" className="mt-1 block h-10 rounded-lg border border-line px-2 text-sm text-ink">
                  <option>Canada Post</option><option>Purolator</option><option>UPS</option><option>FedEx</option>
                </select>
              </label>
              <button className="h-10 rounded-lg bg-ink px-5 text-sm text-white">
                Mark {labelled.length} labelled order{labelled.length === 1 ? "" : "s"} shipped
              </button>
              <p className="w-full text-xs text-muted">Customers get a “shipped” email. Add tracking numbers later from Orders if you have them.</p>
            </form>
          )}
        </section>

        {!done && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Take an order out of this batch</summary>
            <form action={removeFromSession} className="mt-3 flex flex-wrap gap-2">
              <input type="hidden" name="session_id" value={s.id} />
              <select name="order_id" className="h-9 rounded-lg border border-line px-2">
                {orders.filter((o) => !["shipped", "delivered"].includes(o.status)).map((o) => (
                  <option key={o.order_id} value={o.order_id}>{o.bin} · {o.order_number}</option>
                ))}
              </select>
              <input name="reason" required placeholder="Why? e.g. item unavailable" className="h-9 w-64 rounded-lg border border-line px-2" />
              <button className="h-9 rounded-lg border border-bad/40 px-3 text-bad">Remove</button>
            </form>
            <p className="mt-1 text-xs text-muted">It goes back to the waiting list; refund it from Orders if needed.</p>
          </details>
        )}
      </div>
    </div>
  );
}
