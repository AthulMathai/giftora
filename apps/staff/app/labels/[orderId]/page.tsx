import { notFound } from "next/navigation";
import { AutoPrint } from "@/components/auto-print";
import { ShippingLabel, type LabelData } from "@/components/shipping-label";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordLabelPrint } from "../actions";

export const metadata = { title: "Label" };
export const dynamic = "force-dynamic";

export default async function LabelPage({ params, searchParams }: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const staff = await requireStaff("fulfillment.operate");
  const { orderId } = await params;
  const { print } = await searchParams;
  const { data } = await createAdminClient().rpc("svc_label_data", { p_actor: staff.userId, p_order_id: orderId });
  const d = data as LabelData | null;
  if (!d) notFound();
  const ready = ["ready_to_ship", "packed", "shipped"].includes(d.status);

  return (
    <div className="label-sheet">
      <style>{`
        @page { size: 4in 6in; margin: 0; }
        @media print {
          html, body { background: #fff !important; margin: 0 !important; }
          header, nav { display: none !important; }
          main { padding: 0 !important; max-width: none !important; }
          .label-page { page-break-after: always; break-after: page; }
        }
      `}</style>
      {!ready ? (
        <p className="text-sm text-bad">This bin isn&apos;t complete yet, so its label can&apos;t print.</p>
      ) : (
        <>
          <ShippingLabel d={d} />
          {print === "1" && <AutoPrint record={recordLabelPrint.bind(null, [d.order_id])} />}
        </>
      )}
    </div>
  );
}
