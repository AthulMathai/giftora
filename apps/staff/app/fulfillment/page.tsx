import Link from "next/link";
import { Button, Input, Notice, Panel } from "@/components/form";
import { requireStaff } from "@/lib/auth";
import { getVolume, listSessions, torontoDate } from "@/lib/fulfillment";
import { dateTime } from "@/lib/orders";
import { createSession } from "./actions";

export const metadata = { title: "Fulfillment" };
export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  picking: "bg-accent/10 text-accent", sorting: "bg-warn/10 text-warn", packing: "bg-warn/10 text-warn",
  completed: "bg-ok/10 text-ok", cancelled: "bg-line text-muted",
};

export default async function FulfillmentPage({ searchParams }: {
  searchParams: Promise<{ from?: string; to?: string; error?: string; closed?: string }>;
}) {
  const staff = await requireStaff("fulfillment.operate");
  const sp = await searchParams;
  const today = torontoDate();
  const from = sp.from ?? torontoDate(-6);
  const to = sp.to ?? today;
  const [volume, sessions] = await Promise.all([getVolume(staff.userId, from, to), listSessions(staff.userId)]);
  const total = volume.reduce((t, r) => ({
    orders: t.orders + Number(r.orders), lines: t.lines + Number(r.lines), units: t.units + Number(r.units), waiting: t.waiting + Number(r.waiting),
  }), { orders: 0, lines: 0, units: 0, waiting: 0 });

  const quick = [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: torontoDate(-1), to: torontoDate(-1) },
    { label: "Last 7 days", from: torontoDate(-6), to: today },
  ];
  const fmtDay = (d: string) => new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Fulfillment</h1>
        <div className="flex gap-4 text-sm">
          <Link href="/fulfillment/bins" className="underline">Bins</Link>
          <Link href="/exceptions" className="underline">Exceptions</Link>
        </div>
      </div>
      {sp.error && <Notice tone="bad">{sp.error}</Notice>}
      {sp.closed && <Notice tone="ok">Session closed.</Notice>}

      <Panel title="Orders waiting, by day paid">
        <div className="flex flex-wrap items-end gap-2">
          {quick.map((q) => (
            <Link key={q.label} href={`/fulfillment?from=${q.from}&to=${q.to}`}
                  className={`rounded-md px-3 py-1.5 text-sm ${q.from === from && q.to === to ? "bg-ink text-white" : "border border-line bg-white"}`}>
              {q.label}
            </Link>
          ))}
          <form className="ml-auto flex items-end gap-2">
            <Input label="From" type="date" name="from" defaultValue={from} />
            <Input label="To" type="date" name="to" defaultValue={to} />
            <Button variant="secondary">Show</Button>
          </form>
        </div>

        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="pb-2 font-normal">Day</th>
              <th className="pb-2 text-right font-normal">Orders</th>
              <th className="pb-2 text-right font-normal">Lines</th>
              <th className="pb-2 text-right font-normal">Unique SKUs</th>
              <th className="pb-2 text-right font-normal">Units</th>
              <th className="pb-2 text-right font-normal">Waiting</th>
              <th className="pb-2 text-right font-normal">In progress</th>
              <th className="pb-2 text-right font-normal">Shipped</th>
            </tr>
          </thead>
          <tbody>
            {volume.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-muted">No paid orders in this range.</td></tr>}
            {volume.map((r) => (
              <tr key={r.day} className="border-t border-line">
                <td className="py-2">{fmtDay(r.day)}</td>
                <td className="py-2 text-right">{r.orders}</td>
                <td className="py-2 text-right">{r.lines}</td>
                <td className="py-2 text-right">{r.unique_skus}</td>
                <td className="py-2 text-right">{r.units}</td>
                <td className={`py-2 text-right ${Number(r.waiting) > 0 ? "font-semibold text-accent" : ""}`}>{r.waiting}</td>
                <td className="py-2 text-right">{r.in_progress}</td>
                <td className="py-2 text-right">{r.shipped}</td>
              </tr>
            ))}
          </tbody>
          {volume.length > 1 && (
            <tfoot className="border-t-2 border-ink font-semibold">
              <tr><td className="py-2">Total</td><td className="py-2 text-right">{total.orders}</td><td className="py-2 text-right">{total.lines}</td>
                <td /><td className="py-2 text-right">{total.units}</td><td className="py-2 text-right">{total.waiting}</td><td /><td /></tr>
            </tfoot>
          )}
        </table>

        <form action={createSession} className="mt-5 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <Input label="Note (optional)" name="notes" placeholder="e.g. Tuesday morning run" className="w-72" />
          <Button disabled={total.waiting === 0}>Start session for {total.waiting} waiting order{total.waiting === 1 ? "" : "s"}</Button>
          <p className="text-xs text-muted">Gives each order a bin and builds one combined pick list.</p>
        </form>
      </Panel>

      <Panel title="Sessions">
        {sessions.length === 0 ? <p className="text-sm text-muted">No sessions yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="pb-2 font-normal">Session</th><th className="pb-2 font-normal">Status</th><th className="pb-2 font-normal">Orders paid</th>
                <th className="pb-2 text-right font-normal">Orders</th><th className="pb-2 text-right font-normal">Units</th>
                <th className="pb-2 text-right font-normal">Shipped</th><th className="pb-2 font-normal">Started</th></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="py-2"><Link href={`/fulfillment/${s.id}`} className="font-mono font-semibold hover:underline">{s.code}</Link></td>
                  <td className="py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[s.status] ?? ""}`}>{s.status}</span></td>
                  <td className="py-2 text-muted">{s.date_from === s.date_to ? fmtDay(s.date_from) : `${fmtDay(s.date_from)} – ${fmtDay(s.date_to)}`}</td>
                  <td className="py-2 text-right">{s.orders}</td>
                  <td className="py-2 text-right">{s.units}</td>
                  <td className="py-2 text-right">{s.shipped}/{s.orders}</td>
                  <td className="py-2 text-muted">{dateTime(s.created_at)}{s.created_by ? ` · ${s.created_by}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
