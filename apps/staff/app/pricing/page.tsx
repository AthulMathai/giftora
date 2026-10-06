import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { computePrice } from "@giftora/pricing";
import { Button, Input, Notice, Panel, Select } from "@/components/form";
import { requireStaff } from "@/lib/auth";
import { cad, friendly, listCategories, listProducts, parseMoney } from "@/lib/catalog";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

interface Rule {
  id: string; scope: string; rule_type: string; rate: number; min_margin: number | null; min_profit_cents: number | null;
  rounding: string | null; notes: string | null; target_id: string | null; target_name: string | null; updated_at: string;
}

const pct = (x: number | null | undefined) => (x == null ? "" : `${+(Number(x) * 100).toFixed(2)}`);

async function saveRule(formData: FormData) {
  "use server";
  const staff = await requireStaff("pricing.edit");
  const rate = Number(formData.get("rate")) / 100;
  const minMargin = String(formData.get("min_margin") ?? "").trim();
  let minProfit: number | null = null;
  try { minProfit = parseMoney(formData.get("min_profit")); } catch (e) { redirect("/pricing?error=" + encodeURIComponent((e as Error).message)); }
  if (!Number.isFinite(rate) || rate < 0 || (formData.get("rule_type") === "margin" && rate >= 1)) {
    redirect("/pricing?error=" + encodeURIComponent("Enter a rate between 0 and 99.99%."));
  }
  const { error } = await createAdminClient().rpc("svc_pricing_rule_save", {
    p_actor: staff.userId,
    p: {
      scope: formData.get("scope"), target_id: formData.get("target_id"),
      rule_type: formData.get("rule_type"), rate,
      min_margin: minMargin === "" ? null : Number(minMargin) / 100,
      min_profit_cents: minProfit,
      rounding: formData.get("rounding") || null,
      notes: formData.get("notes"), reason: formData.get("reason"),
    },
  });
  if (error) redirect("/pricing?error=" + encodeURIComponent(friendly(error.message)));
  revalidatePath("/pricing");
  revalidatePath("/products");
  redirect("/pricing?saved=1");
}

async function removeRule(formData: FormData) {
  "use server";
  const staff = await requireStaff("pricing.edit");
  const { error } = await createAdminClient().rpc("svc_pricing_rule_remove", {
    p_actor: staff.userId, p_rule_id: String(formData.get("id")), p_reason: "Removed in staff app",
  });
  if (error) redirect("/pricing?error=" + encodeURIComponent(friendly(error.message)));
  revalidatePath("/pricing");
  redirect("/pricing?saved=1");
}

export default async function PricingPage({ searchParams }: {
  searchParams: Promise<{ error?: string; saved?: string; preview_type?: string; preview_rate?: string }>;
}) {
  const staff = await requireStaff("finance.view");
  const { error, saved, preview_type, preview_rate } = await searchParams;
  const admin = createAdminClient();
  const [{ data: rulesData }, categories, products] = await Promise.all([
    admin.rpc("svc_pricing_rules", { p_actor: staff.userId }),
    listCategories(staff.userId),
    listProducts(staff.userId),
  ]);
  const rules = (rulesData ?? []) as Rule[];
  const global = rules.find((r) => r.scope === "global");
  const canEdit = staff.can("pricing.edit");

  let preview: { variants_affected: number; avg_old_price_cents: number; avg_new_price_cents: number } | null = null;
  if (preview_type && preview_rate) {
    const { data } = await admin.rpc("svc_pricing_preview", {
      p_actor: staff.userId, p_rule_type: preview_type, p_rate: Number(preview_rate) / 100,
    });
    preview = data;
  }
  const example = global ? computePrice({
    costCents: 2000, ruleType: global.rule_type as "markup" | "margin", rate: Number(global.rate),
    minMargin: Number(global.min_margin ?? 0), minProfitCents: Number(global.min_profit_cents ?? 0),
    rounding: (global.rounding ?? "none") as "none" | "charm_99",
  }) : null;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pricing</h1>
        <p className="mt-1 text-sm text-muted">
          Prices are calculated from supplier cost. The most specific rule wins: variant, then product, then category, then global.
          Past orders never change. Try numbers in the <Link href="/tools/pricing" className="underline">calculator</Link>.
        </p>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {saved && !error && <Notice tone="ok">Saved. All affected prices were recalculated.</Notice>}

      <Panel title="Active rules">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr><th className="pb-2 font-normal">Applies to</th><th className="pb-2 font-normal">Rule</th><th className="pb-2 font-normal">Floors</th><th className="pb-2 font-normal">Rounding</th><th /></tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-2"><span className="text-xs uppercase text-muted">{r.scope}</span> {r.target_name ?? "Everything"}</td>
                <td className="py-2 font-medium">{pct(r.rate)}% {r.rule_type}</td>
                <td className="py-2 text-muted">
                  {[r.min_margin != null && `min ${pct(r.min_margin)}% margin`, r.min_profit_cents != null && `min ${cad(r.min_profit_cents)} profit`]
                    .filter(Boolean).join(", ") || (r.scope === "global" ? "none" : "from global")}
                </td>
                <td className="py-2 text-muted">{r.rounding === "charm_99" ? "up to .99" : r.rounding === "none" ? "none" : "from global"}</td>
                <td className="py-2 text-right">
                  {canEdit && r.scope !== "global" && (
                    <form action={removeRule}><input type="hidden" name="id" value={r.id} /><button className="text-xs text-bad">Remove</button></form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {example && <p className="mt-3 text-xs text-muted">Global rule today: a $20.00 cost sells for {cad(example.priceCents)} ({(example.trueMargin * 100).toFixed(1)}% true margin).</p>}
      </Panel>

      <Panel title="Preview a global change">
        <form className="flex flex-wrap items-end gap-3">
          <Select label="Type" name="preview_type" defaultValue={preview_type ?? global?.rule_type ?? "margin"} className="w-36">
            <option value="margin">Margin</option><option value="markup">Markup</option>
          </Select>
          <Input label="Rate (%)" name="preview_rate" defaultValue={preview_rate ?? pct(global?.rate)} inputMode="decimal" className="w-28" />
          <Button variant="secondary">Preview</Button>
        </form>
        {preview && (
          <p className="mt-3 text-sm">
            {preview.variants_affected} variant{preview.variants_affected === 1 ? "" : "s"} on the global rule would change price.
            Average price {cad(preview.avg_old_price_cents)} → <strong>{cad(preview.avg_new_price_cents)}</strong>.
          </p>
        )}
      </Panel>

      {canEdit && (
        <Panel title="Set a rule">
          <form action={saveRule} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="Applies to" name="scope" defaultValue="global">
              <option value="global">Everything (global)</option>
              <option value="category">A category</option>
              <option value="product">A product</option>
            </Select>
            <Select label="Category or product" name="target_id" defaultValue="" className="lg:col-span-3">
              <option value="">— for global rules leave this empty —</option>
              <optgroup label="Categories">{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
              <optgroup label="Products">{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
            </Select>
            <Select label="Type" name="rule_type" defaultValue="margin">
              <option value="margin">Margin (% of selling price)</option>
              <option value="markup">Markup (% of cost)</option>
            </Select>
            <Input label="Rate (%)" name="rate" required inputMode="decimal" placeholder="10" />
            <Input label="Minimum margin (%)" name="min_margin" inputMode="decimal" placeholder="optional" />
            <Input label="Minimum profit per unit (CAD)" name="min_profit" inputMode="decimal" placeholder="optional" />
            <Select label="Rounding" name="rounding" defaultValue="">
              <option value="">Same as global</option>
              <option value="charm_99">Round up to .99</option>
              <option value="none">No rounding</option>
            </Select>
            <Input label="Reason (kept in the audit log)" name="reason" className="sm:col-span-2 lg:col-span-3" placeholder="e.g. Q4 margin increase" />
            <div className="sm:col-span-2 lg:col-span-4">
              <Button>Save rule and reprice</Button>
              <p className="mt-2 text-xs text-muted">Saving replaces any existing rule for the same target. Choosing the matching scope matters: a product in the &ldquo;Category&rdquo; scope is ignored.</p>
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}
