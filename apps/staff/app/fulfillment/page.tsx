import Link from "next/link";
import { Notice } from "@/components/form";
import { requireStaff } from "@/lib/auth";
import { getVolume, listSessions, torontoDate } from "@/lib/fulfillment";
import { dateTime } from "@/lib/orders";
import { createSession } from "./actions";

export const metadata = { title: "Batches" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  picking: { label: "Picking", cls: "bg-accent/10 text-accent" },
  sorting: { label: "Sorting", cls: "bg-warn/10 text-warn" },
  packing: { label: "Labelling", cls: "bg-warn/10 text-warn" },
  completed: { label: "Done", cls: "bg-ok/10 text-ok" },
  cancelled: { label: "Cancelled", cls: "bg-line text-muted" },
};

export default async function BatchesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const staff = await requireStaff("fulfillment.operate");
  const { error } = await searchParams;
  const today = torontoDate();
  const from = torontoDate(-60);
  const [volume, batches] = await Promise.all([getVolume(staff.userId, from, today), listSessions(staff.userId)]);
  const waiting = volume.reduce((t, r) => t + Number(r.waiting), 0);
  const open = batches.filter((b) => b.status !== "completed" && b.status !== "cancelled");
  const fmtDay = (d: string) => new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d));

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Batches</h1>
        <div className="flex gap-4 text-sm"><Link href="/fulfillment/bins" className="underline">Bin labels</Link><Link href="/exceptions" className="underline">Short picks</Link></div>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}

      <section className="rounded-2xl border-2 border-ink bg-panel p-6">
        <p className="text-sm text-muted">Paid orders waiting to be picked</p>
        <p className="text-5xl font-bold">{waiting}</p>
        <form action={createSession} className="mt-4">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={today} />
          <button disabled={waiting === 0} className="h-12 rounded-xl bg-ink px-6 text-white disabled:opacity-40">
            {waiting === 0 ? "Nothing waiting" : `Start a batch with ${waiting} order${waiting === 1 ? "" : "s"}`}
          </button>
        </form>
        <p className="mt-2 text-xs text-muted">Each order gets a bin, and you get one combined pick list. The batch number goes on every label.</p>
      </section>

      {open.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">In progress</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {open.map((b) => (
              <Link key={b.id} href={`/fulfillment/${b.id}`} className="rounded-xl border-2 border-ink bg-panel p-4 hover:bg-canvas">
                <p className="font-mono text-xl font-bold">{b.code}</p>
                <p className="mt-1 text-sm"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[b.status]?.cls}`}>{STATUS[b.status]?.label}</span> · {b.orders} orders · {b.shipped} shipped</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">All batches</h2>
        {batches.length === 0 ? <p className="text-sm text-muted">No batches yet.</p> : (
          <table className="w-full rounded-xl border border-line bg-panel text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="p-3 font-normal">Batch</th><th className="p-3 font-normal">Status</th><th className="p-3 text-right font-normal">Orders</th>
                <th className="p-3 text-right font-normal">Units</th><th className="p-3 text-right font-normal">Shipped</th><th className="p-3 font-normal">Started</th></tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-line">
                  <td className="p-3"><Link href={`/fulfillment/${b.id}`} className="font-mono font-semibold hover:underline">{b.code}</Link></td>
                  <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[b.status]?.cls}`}>{STATUS[b.status]?.label}</span></td>
                  <td className="p-3 text-right">{b.orders}</td>
                  <td className="p-3 text-right">{b.units}</td>
                  <td className="p-3 text-right">{b.shipped}/{b.orders}</td>
                  <td className="p-3 text-muted">{dateTime(b.created_at)}{b.created_by ? ` · ${b.created_by}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Daily order volume (last 60 days)</summary>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="pb-1 font-normal">Day</th><th className="pb-1 text-right font-normal">Orders</th><th className="pb-1 text-right font-normal">Units</th><th className="pb-1 text-right font-normal">Waiting</th><th className="pb-1 text-right font-normal">Shipped</th></tr></thead>
          <tbody>
            {[...volume].reverse().map((r) => (
              <tr key={r.day} className="border-t border-line">
                <td className="py-1">{fmtDay(r.day)}</td><td className="py-1 text-right">{r.orders}</td><td className="py-1 text-right">{r.units}</td>
                <td className="py-1 text-right">{r.waiting}</td><td className="py-1 text-right">{r.shipped}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
