import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatCad } from "@/lib/format";
import { formatDate, getMyOrder, STATUS_LABEL } from "@/lib/orders";

export const metadata = { title: "Order", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  await requireUser(`/account/orders/${number}`);
  const result = await getMyOrder(number);
  if (!result) notFound();
  const { order: o, items, events } = result;
  const addr = o.shipping_address;
  const tax = o.tax_breakdown;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-12">
      <Link href="/account" className="text-sm text-muted hover:text-coral">← Your account</Link>
      <div className="mt-4">
        <PageTitle sub={`Placed ${formatDate(o.placed_at)}`}>Order {o.order_number}</PageTitle>
      </div>

      <div className="grid gap-10 md:grid-cols-[1fr_280px]">
        <div>
          <div className="rounded-2xl border border-line bg-paper p-6">
            <p className="text-sm text-muted">Status</p>
            <p className="mt-1 font-display text-2xl">{STATUS_LABEL[o.status] ?? o.status}</p>
            <OrderProgress status={o.status} />
            {o.tracking_number && (
              <p className="mt-3 text-sm">
                {o.carrier} tracking:{" "}
                {o.tracking_url ? (
                  <a href={o.tracking_url} target="_blank" rel="noopener noreferrer" className="font-mono underline underline-offset-4">{o.tracking_number}</a>
                ) : (
                  <span className="font-mono">{o.tracking_number}</span>
                )}
              </p>
            )}
            {events.length > 0 && (
              <ol className="mt-6 space-y-3 border-l border-line pl-4">
                {events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="font-medium">{e.message ?? e.type}</span>
                    <span className="ml-2 text-muted">{formatDate(e.created_at)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <ul className="mt-8 divide-y divide-line border-y border-line">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between gap-4 py-4 text-sm">
                <span>
                  <span className="font-medium">{i.product_name}</span>
                  <span className="block text-muted">{i.variant_label} · {i.quantity} × {formatCad(i.unit_price_cents)}</span>
                </span>
                <span>{formatCad(i.line_total_cents)}</span>
              </li>
            ))}
          </ul>
        </div>

        <aside className="space-y-6 text-sm">
          <dl className="space-y-2">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatCad(o.subtotal_cents)}</dd></div>
            <div className="flex justify-between"><dt>Shipping</dt><dd>{o.shipping_cents ? formatCad(o.shipping_cents) : "Free"}</dd></div>
            {tax.hst ? <div className="flex justify-between"><dt>HST</dt><dd>{formatCad(tax.hst)}</dd></div> : null}
            {tax.gst ? <div className="flex justify-between"><dt>GST</dt><dd>{formatCad(tax.gst)}</dd></div> : null}
            {tax.pst ? <div className="flex justify-between"><dt>PST</dt><dd>{formatCad(tax.pst)}</dd></div> : null}
            <div className="flex justify-between border-t border-line pt-2 font-medium"><dt>Total</dt><dd>{formatCad(o.total_cents)}</dd></div>
          </dl>
          <div>
            <p className="font-medium">Shipping to</p>
            <p className="mt-1 text-muted">
              {addr.full_name}<br />{addr.line1}{addr.line2 ? `, ${addr.line2}` : ""}<br />
              {addr.city}, {addr.province} {addr.postal_code}
            </p>
            <p className="mt-2 text-muted">{o.shipping_method_name}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

const STEPS = [
  { label: "Order received", statuses: ["paid"] },
  { label: "Being prepared", statuses: ["processing", "ready_to_ship"] },
  { label: "Packed", statuses: ["packed"] },
  { label: "Shipped", statuses: ["shipped"] },
  { label: "Delivered", statuses: ["delivered", "closed"] },
];

function OrderProgress({ status }: { status: string }) {
  if (status === "cancelled" || status === "pending_payment") return null;
  const current = STEPS.findIndex((s) => s.statuses.includes(status));
  return (
    <ol className="mt-5 grid grid-cols-5 gap-1" aria-label="Order progress">
      {STEPS.map((step, i) => {
        const reached = i <= current;
        return (
          <li key={step.label} className="text-center" aria-current={i === current ? "step" : undefined}>
            <div className={`h-1.5 rounded-full ${reached ? "bg-coral" : "bg-line"}`} />
            <p className={`mt-2 text-[11px] leading-tight sm:text-xs ${i === current ? "font-semibold text-ink" : reached ? "text-ink" : "text-muted"}`}>
              {step.label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
