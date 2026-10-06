import { saveVariant } from "@/app/products/actions";
import { cad, describeRule, type VariantDetail } from "@/lib/catalog";
import { dateTime } from "@/lib/orders";
import { Button, Input, Select } from "./form";

interface Props {
  productId: string;
  optionNames: string[];
  variant?: VariantDetail;
  canEdit: boolean;
  canSupply: boolean;
  canFinance: boolean;
}

const money = (c?: number) => (c == null ? "" : (c / 100).toFixed(2));

export function VariantForm({ productId, optionNames, variant: v, canEdit, canSupply, canFinance }: Props) {
  const isNew = !v;
  const profit = v?.price_cents != null && v?.cost_cents != null ? v.price_cents - v.cost_cents : null;
  return (
    <form action={saveVariant} className={`rounded-xl border p-4 ${v && !v.is_active ? "border-dashed border-line bg-canvas/50" : "border-line bg-white"}`}>
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="option_names" value={optionNames.join(",")} />
      {v && <input type="hidden" name="id" value={v.id} />}

      {v && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <p className="font-mono text-sm font-semibold">{v.sku} <span className="font-sans font-normal text-muted">· {v.label}</span></p>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>Price <strong>{cad(v.price_cents)}</strong></span>
            {canFinance && profit != null && <span className="text-ok">Profit {cad(profit)} ({v.price_cents ? Math.round((profit / v.price_cents!) * 100) : 0}%)</span>}
            <span className={v.available === 0 ? "text-bad" : ""}>Can sell <strong>{v.available}</strong></span>
          </div>
        </div>
      )}

      <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="SKU" name="sku" defaultValue={v?.sku} required placeholder="MUG-BLU" className="font-mono" />
        {optionNames.map((n) => (
          <Input key={n} label={n} name={`opt_${n}`} defaultValue={v?.options?.[n]} required />
        ))}
        <Input label="Label" name="label" defaultValue={v?.label} placeholder={optionNames.length ? "Auto from options" : "Default"} />
        <Input label="Compare-at price (optional)" name="compare_at" defaultValue={money(v?.compare_at_cents)} inputMode="decimal"
               hint="Shown crossed out." />
        <Input label="Weight (g)" name="weight_grams" defaultValue={v?.weight_grams} inputMode="numeric" />

        {canSupply && (
          <>
            <Input label="Supplier cost (CAD)" name="cost" defaultValue={canFinance ? money(v?.cost_cents) : ""} inputMode="decimal"
                   required={isNew} placeholder="20.00" />
            <Input label="Supplier has (units)" name="on_hand_qty" defaultValue={v?.on_hand_qty} inputMode="numeric" />
            <Select label="Supplier status" name="supply_status" defaultValue={v?.supply_status ?? "available"}>
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
              <option value="discontinued">Discontinued</option>
            </Select>
            <Input label="Aisle / location" name="aisle_location" defaultValue={v?.aisle_location} />
            <Input label="Supplier SKU" name="supplier_sku" defaultValue={v?.supplier_sku} />
            <Input label="Supplier barcode (single item)" name="supplier_barcode" defaultValue={v?.supplier_barcode} inputMode="numeric" />
            <Input label="Inner pack: units" name="inner_qty" defaultValue={v?.inner_qty ?? ""} inputMode="numeric" placeholder="e.g. 6" />
            <Input label="Inner pack barcode" name="inner_barcode" defaultValue={v?.inner_barcode ?? ""} />
            <Input label="Outer case: units" name="outer_qty" defaultValue={v?.outer_qty ?? ""} inputMode="numeric" placeholder="e.g. 12"
                   hint="Total single units in the case, not inners." />
            <Input label="Outer case barcode" name="outer_barcode" defaultValue={v?.outer_barcode ?? ""} />
          </>
        )}
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="is_active" defaultChecked={v?.is_active ?? true} className="size-4 accent-ink" /> For sale
        </label>
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {canFinance && v && <>Pricing: {describeRule(v.rule)}. </>}
          {v?.last_checked_at && <>Stock last checked {dateTime(v.last_checked_at)}. </>}
          {canSupply && "Saving supplier details counts as a fresh stock check."}
        </p>
        {canEdit && <Button variant={isNew ? "primary" : "secondary"}>{isNew ? "Add variant" : "Save variant"}</Button>}
      </div>
    </form>
  );
}
