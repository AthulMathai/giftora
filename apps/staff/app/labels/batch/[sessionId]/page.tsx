import { AutoPrint } from "@/components/auto-print";
import { ShippingLabel, type LabelData } from "@/components/shipping-label";
import { requireStaff } from "@/lib/auth";
import { getSession } from "@/lib/fulfillment";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordLabelPrint } from "../../actions";

export const metadata = { title: "Batch labels" };
export const dynamic = "force-dynamic";

/** Every complete bin's label in bin order (BIN-001 first), one 4×6 page each. */
export default async function BatchLabelsPage({ params, searchParams }: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ only?: string }>;
}) {
  const staff = await requireStaff("fulfillment.operate");
  const { sessionId } = await params;
  const { only } = await searchParams; // "unprinted" = only bins without a label yet
  const s = await getSession(staff.userId, sessionId);
  const admin = createAdminClient();
  const { data: labels } = await admin.rpc("svc_batch_labels", { p_actor: staff.userId, p_session_id: sessionId });
  const printed = (labels ?? {}) as Record<string, { count: number }>;

  const orders = (s?.orders ?? [])
    .filter((o) => !o.removed && ["ready_to_ship", "packed"].includes(o.status))
    .filter((o) => only !== "unprinted" || !printed[o.order_id]?.count)
    .sort((a, b) => a.position - b.position);
  const data = await Promise.all(orders.map(async (o) =>
    (await admin.rpc("svc_label_data", { p_actor: staff.userId, p_order_id: o.order_id })).data as LabelData));

  return (
    <div>
      <style>{`
        @page { size: 4in 6in; margin: 0; }
        @media print {
          html, body { background: #fff !important; margin: 0 !important; }
          header, nav { display: none !important; }
          main { padding: 0 !important; max-width: none !important; }
          .label-page { page-break-after: always; break-after: page; }
        }
      `}</style>
      {data.length === 0 ? <p className="text-sm text-muted">No complete bins to print.</p> : (
        <>
          <div className="flex flex-col gap-4 print:gap-0">{data.map((d) => <ShippingLabel key={d.order_id} d={d} />)}</div>
          <AutoPrint record={recordLabelPrint.bind(null, data.map((d) => d.order_id))} />
        </>
      )}
    </div>
  );
}
