import Link from "next/link";
import type { ReactNode } from "react";
import { Notice, Panel } from "@/components/form";
import { requireStaff } from "@/lib/auth";
import { torontoDate } from "@/lib/fulfillment";
import { cad } from "@/lib/orders";
import { SOURCE_BADGE } from "@/lib/staff-orders";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

interface Analytics {
  range: { from: string; to: string };
  totals: {
    visitors: number; sessions: number; page_views: number; product_views: number; add_to_carts: number; checkouts: number;
    orders: number; web_orders: number; gross_sales_cents: number; refunds_cents: number; avg_order_cents: number;
    conversion_rate: number | null; gross_profit_cents: number | null;
  };
  funnel: { step: string; sessions: number }[];
  daily: { date: string; visitors: number; orders: number; sales_cents: number }[];
  top_products: { id: string; name: string; slug: string; views: number; add_to_carts: number; units: number; sales_cents: number }[];
  searches: { query: string; count: number; avg_results: number | null; no_results: number }[];
  sources: { source: string; sessions: number; purchases: number }[];
  devices: Record<string, number>;
  order_sources: { source: string; orders: number; sales_cents: number }[];
  campaigns: { slug: string; views: number; visitors: number }[];
}

const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "year", label: "This year" },
] as const;

function rangeDates(key: string): { from: string; to: string } {
  const to = torontoDate();
  switch (key) {
    case "today": return { from: to, to };
    case "7d": return { from: torontoDate(-6), to };
    case "90d": return { from: torontoDate(-89), to };
    case "year": return { from: `${to.slice(0, 4)}-01-01`, to };
    default: return { from: torontoDate(-29), to };
  }
}

const num = (n: number) => new Intl.NumberFormat("en-CA").format(n);
const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
const shortDate = (d: string) =>
  new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const staff = await requireStaff("analytics.view");
  const { range = "30d" } = await searchParams;
  const active = RANGES.find((r) => r.key === range)?.key ?? "30d";
  const { from, to } = rangeDates(active);

  const { data, error } = await createAdminClient().rpc("svc_analytics", { p_actor: staff.userId, p_from: from, p_to: to });
  const a = data as Analytics | null;
  const t = a?.totals;
  const noTraffic = !t || t.sessions === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="mt-1 text-sm text-muted">{shortDate(from)}{from !== to && <> – {shortDate(to)}</>} · Toronto time</p>
        </div>
        <nav aria-label="Date range" className="flex gap-1 rounded-lg border border-line bg-panel p-1 text-sm">
          {RANGES.map((r) => (
            <Link key={r.key} href={`/analytics?range=${r.key}`} aria-current={r.key === active ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 ${r.key === active ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
              {r.label}
            </Link>
          ))}
        </nav>
      </div>

      {error && <Notice tone="bad">{error.message}</Notice>}
      {a && t && (
        <>
          {noTraffic && (
            <Notice tone="warn">
              No store visits recorded in this period yet. Numbers appear here as soon as customers start visiting the store.
              {t.orders > 0 && " Orders and sales below still count orders entered by staff."}
            </Notice>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Sales" value={cad(t.gross_sales_cents)} sub={`${num(t.orders)} order${t.orders === 1 ? "" : "s"}${t.refunds_cents ? ` · ${cad(t.refunds_cents)} refunded` : ""}`} />
            {t.gross_profit_cents != null && <Tile label="Profit" value={cad(t.gross_profit_cents)} sub="After product cost, fees, discounts and refunds" />}
            <Tile label="Average order" value={t.orders ? cad(t.avg_order_cents) : "—"} />
            <Tile label="Visitors" value={num(t.visitors)} sub={`${num(t.sessions)} visits · ${num(t.page_views)} pages viewed`} />
            <Tile label="Conversion" value={pct(t.conversion_rate)} sub={`Visits that ended in an order (${num(t.web_orders)} web order${t.web_orders === 1 ? "" : "s"})`} />
            <Tile label="Gift views" value={num(t.product_views)} />
            <Tile label="Added to cart" value={num(t.add_to_carts)} />
            <Tile label="Started checkout" value={num(t.checkouts)} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Shopping funnel">
              <Funnel steps={a.funnel} />
            </Panel>
            <Panel title="Day by day">
              <Daily days={a.daily} />
            </Panel>
          </div>

          <Panel title="Top gifts">
            {a.top_products.length === 0 ? <Empty>Gifts appear here once customers view or buy them.</Empty> : (
              <Table head={["Gift", "Views", "Added to cart", "Sold", "Sales"]}>
                {a.top_products.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="py-1.5"><Link href={`/products/${p.id}`} className="hover:underline">{p.name}</Link></td>
                    <Num>{num(p.views)}</Num><Num>{num(p.add_to_carts)}</Num><Num>{num(p.units)}</Num><Num>{cad(p.sales_cents)}</Num>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="What customers searched for">
              {a.searches.length === 0 ? <Empty>Searches appear here once customers use the store&apos;s search box.</Empty> : (
                <>
                  {a.searches.some((s) => s.no_results > 0) && (
                    <p className="mb-3 text-sm text-muted">
                      Searches marked <span className="rounded bg-warn/15 px-1.5 text-ink">no results</span> found nothing —
                      customers want this, so consider sourcing it.
                    </p>
                  )}
                  <Table head={["Search", "Times", "Avg. results"]}>
                    {a.searches.map((s) => (
                      <tr key={s.query} className={`border-t border-line ${s.no_results > 0 ? "bg-warn/10" : ""}`}>
                        <td className="py-1.5">
                          {s.query}
                          {s.no_results > 0 && <span className="ml-2 rounded bg-warn/15 px-1.5 text-xs">no results{s.no_results < s.count ? ` ×${s.no_results}` : ""}</span>}
                        </td>
                        <Num>{num(s.count)}</Num><Num>{s.avg_results ?? "—"}</Num>
                      </tr>
                    ))}
                  </Table>
                </>
              )}
            </Panel>

            <Panel title="Where visitors came from">
              {a.sources.length === 0 ? <Empty>Traffic sources appear once the store gets visitors.</Empty> : (
                <Table head={["Source", "Visits", "Bought"]}>
                  {a.sources.map((s) => (
                    <tr key={s.source} className="border-t border-line">
                      <td className="py-1.5">{s.source === "direct" ? "Direct / typed in" : s.source}</td>
                      <Num>{num(s.sessions)}</Num><Num>{num(s.purchases)}</Num>
                    </tr>
                  ))}
                </Table>
              )}
            </Panel>

            <Panel title="How orders came in">
              {a.order_sources.length === 0 ? <Empty>No orders in this period.</Empty> : (
                <Table head={["Channel", "Orders", "Sales"]}>
                  {a.order_sources.map((s) => (
                    <tr key={s.source} className="border-t border-line">
                      <td className="py-1.5">{s.source === "web" ? "Website" : SOURCE_BADGE[s.source] ?? s.source}</td>
                      <Num>{num(s.orders)}</Num><Num>{cad(s.sales_cents)}</Num>
                    </tr>
                  ))}
                </Table>
              )}
            </Panel>

            <Panel title="Devices">
              <Devices devices={a.devices} />
            </Panel>

            <Panel title="Seasonal campaign pages">
              {a.campaigns.length === 0 ? <Empty>Views of seasonal pages appear here once visitors open them.</Empty> : (
                <Table head={["Campaign", "Views", "Visitors"]}>
                  {a.campaigns.map((c) => (
                    <tr key={c.slug} className="border-t border-line">
                      <td className="py-1.5">{c.slug}</td><Num>{num(c.views)}</Num><Num>{num(c.visitors)}</Num>
                    </tr>
                  ))}
                </Table>
              )}
            </Panel>
          </div>
          <p className="text-xs text-muted">Visitors are counted with a first-party cookie; no IP addresses are stored. Sales include orders entered by staff.</p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted">
        <tr>{head.map((h, i) => <th key={h} className={`pb-1 font-normal ${i > 0 ? "text-right" : ""}`}>{h}</th>)}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

const Num = ({ children }: { children: ReactNode }) => <td className="py-1.5 text-right">{children}</td>;

function Funnel({ steps }: { steps: { step: string; sessions: number }[] }) {
  const top = steps[0]?.sessions ?? 0;
  if (top === 0) return <Empty>The funnel fills in once the store gets visitors.</Empty>;
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1]!.sessions : null;
        return (
          <li key={s.step}>
            <div className="flex items-baseline justify-between text-sm">
              <span>{s.step}</span>
              <span>
                <strong>{num(s.sessions)}</strong>
                {prev != null && <span className="ml-2 text-xs text-muted">{prev > 0 ? `${Math.round((s.sessions / prev) * 100)}% of previous step` : "—"}</span>}
              </span>
            </div>
            <div className="mt-1 h-3 rounded bg-canvas">
              <div className="h-3 rounded bg-ink" style={{ width: `${Math.max((s.sessions / top) * 100, s.sessions ? 1 : 0)}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Two small charts on the same days: sales bars, then visitors bars. Kept separate (rather than
 * one chart with two scales) so neither number is misread against the other's axis.
 */
function Daily({ days }: { days: Analytics["daily"] }) {
  if (days.length === 0) return <Empty>No days in this range.</Empty>;
  if (days.every((d) => d.sales_cents === 0 && d.visitors === 0)) return <Empty>Daily sales and visitors appear here once the store gets activity.</Empty>;
  const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, arr) => arr.indexOf(v) === i);
  return (
    <div className="space-y-4">
      <MiniBars title="Sales" days={days} value={(d) => d.sales_cents} format={(v) => cad(v)} color="var(--color-ink)" />
      <MiniBars title="Visitors" days={days} value={(d) => d.visitors} format={(v) => num(v)} color="var(--color-accent)" />
      <div className="flex justify-between text-xs text-muted">
        {ticks.map((i) => <span key={i}>{shortDate(days[i]!.date)}</span>)}
      </div>
    </div>
  );
}

function MiniBars({ title, days, value, format, color }: {
  title: string; days: Analytics["daily"]; value: (d: Analytics["daily"][number]) => number; format: (v: number) => string; color: string;
}) {
  const W = 600, H = 90;
  const max = Math.max(...days.map(value), 0);
  const step = W / days.length;
  const gap = days.length > 60 ? 0.5 : 2;
  const total = days.reduce((s, d) => s + value(d), 0);
  return (
    <figure>
      <figcaption className="mb-1 flex justify-between text-xs text-muted">
        <span>{title}</span><span>peak {format(max)} · total {format(total)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full" role="img"
           aria-label={`${title} per day, from ${format(0)} to a peak of ${format(max)}`}>
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--color-line)" />
        {days.map((d, i) => {
          const v = value(d);
          const h = max > 0 ? (v / max) * (H - 4) : 0;
          return (
            <g key={d.date}>
              {/* Full-height hit area so hovering anywhere in the column shows the day. */}
              <rect x={i * step} y={0} width={step} height={H} fill="transparent">
                <title>{`${shortDate(d.date)}: ${format(v)}${title === "Sales" ? ` · ${d.orders} order${d.orders === 1 ? "" : "s"}` : ""}`}</title>
              </rect>
              {v > 0 && <rect x={i * step + gap / 2} y={H - h} width={Math.max(step - gap, 0.5)} height={h} rx={Math.min(2, step / 4)} fill={color} pointerEvents="none" />}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function Devices({ devices }: { devices: Record<string, number> }) {
  const entries = Object.entries(devices).sort((x, y) => y[1] - x[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return <Empty>Device types appear once the store gets visitors.</Empty>;
  const label: Record<string, string> = { mobile: "Phone", tablet: "Tablet", desktop: "Computer", unknown: "Unknown" };
  return (
    <ul className="space-y-2 text-sm">
      {entries.map(([k, n]) => (
        <li key={k}>
          <div className="flex justify-between"><span>{label[k] ?? k}</span><span>{num(n)} · {Math.round((n / total) * 100)}%</span></div>
          <div className="mt-1 h-2 rounded bg-canvas"><div className="h-2 rounded bg-ink" style={{ width: `${(n / total) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
