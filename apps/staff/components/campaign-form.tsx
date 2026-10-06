import { saveCampaign } from "@/app/campaigns/actions";
import { THEMES, type Campaign, type PickableProduct } from "@/lib/campaigns";
import { isoToTorontoLocal } from "@/lib/time";
import { CampaignLook } from "./campaign-look";
import { Button, Input, Panel, Select, Textarea } from "./form";

const BLANK_FAQ_ROWS = 4;

export function CampaignForm({ campaign, products }: { campaign?: Campaign; products: PickableProduct[] }) {
  const c = campaign;
  const pinned = new Set(c?.pinned ?? []);
  const faq = [...(c?.faq ?? []), ...Array.from({ length: BLANK_FAQ_ROWS }, () => ({ q: "", a: "" }))];
  const autoJoins = (p: PickableProduct) => !!c?.occasion && (p.occasions ?? []).includes(c.occasion);

  return (
    <form action={saveCampaign} className="space-y-6">
      {c && <input type="hidden" name="id" value={c.id} />}

      <Panel title="Banner and look">
        <CampaignLook initial={{
          name: c?.name ?? "", slug: c?.slug ?? "", eyebrow: c?.eyebrow ?? "", headline: c?.headline ?? "",
          subheadline: c?.subheadline ?? "", cta_label: c?.cta_label ?? "",
          accent_color: c?.accent_color ?? "#d9533b", background_color: c?.background_color ?? "#fbf6ef", ink_color: c?.ink_color ?? "#2b1b2e",
        }} />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Select label="Theme" name="theme" defaultValue={c?.theme ?? "custom"}>
            {THEMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Input label="Occasion tag" name="occasion" defaultValue={c?.occasion ?? ""} placeholder="christmas"
                 hint="Every product tagged with this occasion joins the campaign automatically." />
          <Textarea label="Longer description" name="body" defaultValue={c?.body ?? ""} className="md:col-span-2"
                    hint="Shown on the season's page under the banner." />
        </div>
      </Panel>

      <Panel title="When it runs">
        <p className="mb-4 text-sm text-muted">All times are Toronto time. When the campaign ends, the normal Giftora look comes back by itself.</p>
        <div className="grid gap-4 md:grid-cols-3">
          <Input label="Shop early from (optional)" name="early_from" type="datetime-local" defaultValue={isoToTorontoLocal(c?.early_from)}
                 hint="Before the start, the season shows as a “shop early” section and its gifts can be bought." />
          <Input label="Starts" name="starts_at" type="datetime-local" required defaultValue={isoToTorontoLocal(c?.starts_at)}
                 hint="The season takes over the home page." />
          <Input label="Ends" name="ends_at" type="datetime-local" required defaultValue={isoToTorontoLocal(c?.ends_at)}
                 hint="Its page stays up afterwards for Google." />
          <Textarea label="Shop-early message" name="early_message" defaultValue={c?.early_message ?? ""} className="md:col-span-2"
                    placeholder="Our Christmas gifts are in now. Shop early and we ship right away." />
          <Input label="Priority" name="priority" type="number" step={1} defaultValue={c?.priority ?? 0}
                 hint="If two campaigns overlap, the higher number wins." />
        </div>
        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="restyle_site" defaultChecked={c?.restyle_site ?? true} className="size-4 accent-ink" />
            Use these colours across the whole store while it&apos;s live
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="is_published" defaultChecked={c?.is_published ?? false} className="size-4 accent-ink" />
            Published (customers can see it when its dates come)
          </label>
        </div>
      </Panel>

      <Panel title="Products">
        <p className="mb-3 text-sm text-muted">
          Products tagged with this occasion join automatically; tick extras here.
          {c && <> Right now {c.product_count} product{c.product_count === 1 ? " is" : "s are"} in this campaign.</>}
        </p>
        {products.length === 0 ? (
          <p className="text-sm text-muted">No products are on sale yet.</p>
        ) : (
          <ul className="grid max-h-96 gap-1 overflow-y-auto rounded-lg border border-line bg-white p-3 sm:grid-cols-2">
            {products.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-canvas">
                  <input type="checkbox" name="product_ids" value={p.id} defaultChecked={pinned.has(p.id)} className="size-4 accent-ink" />
                  <span>{p.name}</span>
                  {autoJoins(p) && <span className="text-xs text-ok">joins automatically</span>}
                  {!["active", "seasonal"].includes(p.status) && <span className="text-xs text-muted">(not on sale)</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Search engines and FAQ">
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Search title (SEO)" name="seo_title" defaultValue={c?.seo_title ?? ""} maxLength={70}
                 hint="Shown in Google results. About 60 characters." />
          <Input label="Search description (SEO)" name="seo_description" defaultValue={c?.seo_description ?? ""} maxLength={160}
                 hint="About 150 characters." />
        </div>
        <h3 className="mt-6 text-sm font-semibold">Questions and answers</h3>
        <p className="mt-1 text-sm text-muted">Shown on the season&apos;s page and read by Google and AI search. Leave a row empty to skip it.</p>
        <div className="mt-3 space-y-3">
          {faq.map((f, i) => (
            <div key={i} className="grid gap-3 rounded-lg border border-line bg-white p-3 md:grid-cols-[1fr_2fr]">
              <Input label={`Question ${i + 1}`} name="faq_q" defaultValue={f.q} placeholder="When is the last day to order?" />
              <Input label="Answer" name="faq_a" defaultValue={f.a} placeholder="Order by December 15 for standard shipping." />
            </div>
          ))}
        </div>
      </Panel>

      <Button>{c ? "Save campaign" : "Create campaign"}</Button>
    </form>
  );
}
