import { Barcode } from "./barcode";

export interface LabelData {
  order_id: string; order_number: string; status: string;
  ship_to: Record<string, string | null>; shipping_method: string; carrier: string | null; tracking_number: string | null;
  batch: string | null; bin: string | null; units: number;
  items: { sku: string; product: string; variant: string; quantity: number }[];
  return_address: Record<string, string | null> | null; printed_count: number;
}

/** One 4 × 6 in label. Black on white only, sized for thermal printers. */
export function ShippingLabel({ d }: { d: LabelData }) {
  const to = d.ship_to;
  const from = d.return_address ?? {};
  return (
    <section className="label-page flex flex-col bg-white text-black" style={{ width: "4in", height: "6in", padding: "0.15in", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <div className="flex items-start justify-between border-b-2 border-black pb-1" style={{ fontSize: "8pt", lineHeight: 1.2 }}>
        <div>
          <p className="font-bold">FROM</p>
          <p>{from.name || "Giftora"}</p>
          {from.line1 && <p>{from.line1}{from.line2 ? `, ${from.line2}` : ""}</p>}
          <p>{[from.city, from.province, from.postal_code].filter(Boolean).join(" ")}</p>
        </div>
        <div className="text-right">
          <p className="font-bold" style={{ fontSize: "11pt" }}>{d.shipping_method.split("(")[0]?.trim()}</p>
          {d.carrier && <p>{d.carrier}</p>}
        </div>
      </div>

      <div className="border-b-2 border-black py-2" style={{ lineHeight: 1.25 }}>
        <p className="font-bold" style={{ fontSize: "8pt" }}>SHIP TO</p>
        <p className="font-bold" style={{ fontSize: "16pt" }}>{to.full_name}</p>
        <p style={{ fontSize: "13pt" }}>{to.line1}</p>
        {to.line2 && <p style={{ fontSize: "13pt" }}>{to.line2}</p>}
        <p style={{ fontSize: "13pt" }}>{to.city} {to.province}</p>
        <p className="font-bold tracking-wider" style={{ fontSize: "18pt" }}>{to.postal_code}</p>
        {to.phone && <p style={{ fontSize: "9pt" }}>{to.phone}</p>}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center py-2">
        <Barcode value={d.order_number} height={70} className="h-[0.9in] w-full" />
        <p className="mt-1 font-mono font-bold" style={{ fontSize: "14pt" }}>{d.order_number}</p>
        {d.tracking_number && <p className="font-mono" style={{ fontSize: "9pt" }}>Tracking {d.tracking_number}</p>}
      </div>

      <div className="grid grid-cols-3 border-t-2 border-black pt-1 text-center" style={{ fontSize: "8pt" }}>
        <div><p>BATCH</p><p className="font-bold" style={{ fontSize: "10pt" }}>{d.batch ?? "—"}</p></div>
        <div className="border-x border-black"><p>BIN</p><p className="font-bold" style={{ fontSize: "14pt" }}>{d.bin ?? "—"}</p></div>
        <div><p>UNITS</p><p className="font-bold" style={{ fontSize: "14pt" }}>{d.units}</p></div>
      </div>
    </section>
  );
}
