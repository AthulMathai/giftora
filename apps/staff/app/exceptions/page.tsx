import Link from "next/link";
import { resolveException } from "@/app/fulfillment/actions";
import { Notice } from "@/components/form";
import { requireStaff } from "@/lib/auth";
import { dateTime } from "@/lib/orders";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Exceptions" };
export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  short_pick: "Short pick", damaged: "Damaged", wrong_variant: "Wrong variant scanned", unexpected_item: "Item not required",
  unknown_code: "Unknown barcode", supplier_unavailable: "Supplier unavailable", address_problem: "Address problem",
  shipping_problem: "Shipping problem", other: "Other",
};
const HINT: Record<string, string> = {
  short_pick: "Remove the affected order from the session and refund the missing item, or wait for restock.",
  damaged: "Return it to the supplier if possible; refund or replace for the customer.",
  wrong_variant: "Set the item aside. Check whether the supplier gave the wrong size or colour.",
  unexpected_item: "Set the item aside for return to the supplier or the next session.",
};

interface Ex {
  id: string; kind: string; status: string; sku: string | null; quantity: number | null; notes: string | null; resolution: string | null;
  created_at: string; resolved_at: string | null; session_id: string | null; session: string | null; order_id: string | null;
  order_number: string | null; product: string | null; created_by: string | null; affected_orders: string[] | null;
}

export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<{ show?: string; error?: string }> }) {
  const staff = await requireStaff("fulfillment.operate");
  const { show = "open", error } = await searchParams;
  const { data } = await createAdminClient().rpc("svc_exceptions", { p_actor: staff.userId, p_status: show === "all" ? null : show });
  const rows = (data ?? []) as Ex[];

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Exceptions</h1>
        <nav className="flex gap-1 text-sm">
          {["open", "resolved", "all"].map((k) => (
            <Link key={k} href={`/exceptions?show=${k}`} className={`rounded-md px-3 py-1.5 capitalize ${show === k ? "bg-ink text-white" : "text-muted"}`}>{k}</Link>
          ))}
        </nav>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {rows.length === 0 && <p className="text-sm text-muted">{show === "open" ? "Nothing needs attention." : "None."}</p>}
      <div className="space-y-3">
        {rows.map((e) => (
          <article key={e.id} className={`rounded-xl border bg-panel p-4 ${e.status === "open" ? "border-warn/50" : "border-line"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="font-semibold">{LABEL[e.kind] ?? e.kind}
                {e.sku && <span className="ml-2 font-mono text-sm">{e.sku}</span>}
                {e.quantity != null && <span className="ml-1 text-sm text-muted">× {e.quantity}</span>}
              </p>
              <p className="text-xs text-muted">
                {dateTime(e.created_at)}{e.created_by ? ` · ${e.created_by}` : ""}
                {e.session && <> · <Link href={`/fulfillment/${e.session_id}`} className="underline">{e.session}</Link></>}
                {e.order_number && <> · {e.order_number}</>}
              </p>
            </div>
            {e.product && <p className="text-sm">{e.product}</p>}
            {e.notes && <p className="text-sm text-muted">“{e.notes}”</p>}
            {e.affected_orders && e.affected_orders.length > 0 && (
              <p className="mt-1 text-sm">Waiting on this item: <strong>{e.affected_orders.join(", ")}</strong></p>
            )}
            {e.status === "open" ? (
              <>
                {HINT[e.kind] && <p className="mt-2 text-xs text-muted">Suggested: {HINT[e.kind]}</p>}
                <form action={resolveException} className="mt-3 flex gap-2">
                  <input type="hidden" name="id" value={e.id} />
                  <input name="resolution" required placeholder="What did you do? e.g. Refunded GFT-1002 for the missing item"
                         className="h-9 flex-1 rounded-lg border border-line px-3 text-sm" />
                  <button className="h-9 rounded-lg bg-ink px-4 text-sm text-white">Resolve</button>
                </form>
              </>
            ) : (
              <p className="mt-2 text-sm text-ok">Resolved {dateTime(e.resolved_at)}: {e.resolution}</p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
