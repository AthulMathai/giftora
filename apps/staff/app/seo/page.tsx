import Link from "next/link";
import { Notice, Panel } from "@/components/form";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "SEO" };
export const dynamic = "force-dynamic";

interface Audit {
  products: { id: string; name: string; slug: string; issues: string[] }[];
  categories: { id: string; name: string; issues: string[] }[];
  live_products: number;
}

const AUTOMATIC = [
  ["Product details for Google", "Every product page tells Google its price, availability, photos and reviews (structured data), so it can show rich results."],
  ["Sitemap", "A list of every live page is kept up to date for search engines automatically."],
  ["AI search (llms.txt)", "A plain summary of the store and its gifts that AI assistants like ChatGPT and Claude can read."],
  ["Share previews", "Links shared on Facebook, Instagram, iMessage and others show a photo, title and description (Open Graph)."],
  ["One address per page", "Each page names its main web address (canonical URL), so duplicates don't compete in Google."],
  ["FAQ answers", "Seasonal and occasion pages publish their questions and answers in a format Google and AI search understand."],
] as const;

export default async function SeoPage() {
  const staff = await requireStaff("catalog.view");
  const { data, error } = await createAdminClient().rpc("svc_seo_audit", { p_actor: staff.userId });
  const audit = data as Audit | null;
  const live = audit?.live_products ?? 0;
  const ready = live - (audit?.products.length ?? 0);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">SEO checklist</h1>
        <p className="mt-1 text-sm text-muted">What&apos;s still missing to help customers find our gifts on Google and in AI search.</p>
      </div>
      {error && <Notice tone="bad">{error.message}</Notice>}

      {audit && (
        <>
          <div className="rounded-xl border border-line bg-panel p-5">
            {live === 0 ? (
              <p className="text-sm text-muted">No products are live yet. Once products are on sale, they&apos;re checked here.</p>
            ) : (
              <>
                <p className="text-lg">
                  <strong className="text-3xl font-semibold">{ready} of {live}</strong> live product{live === 1 ? " is" : "s are"} fully set up
                </p>
                <div className="mt-3 h-2 rounded bg-canvas" role="progressbar" aria-valuemin={0} aria-valuemax={live} aria-valuenow={ready}
                     aria-label="Products fully set up">
                  <div className="h-2 rounded bg-ok" style={{ width: `${(ready / live) * 100}%` }} />
                </div>
              </>
            )}
          </div>

          <Panel title={`Products to improve (${audit.products.length})`}>
            {audit.products.length === 0 ? (
              <p className="text-sm text-ok">Every live product has everything it needs. Nice work.</p>
            ) : (
              <ul className="divide-y divide-line">
                {audit.products.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{p.name}</p>
                      <ul className="mt-1 flex flex-wrap gap-1.5">
                        {p.issues.map((i) => <li key={i} className="rounded-full bg-warn/10 px-2.5 py-0.5 text-xs">{i}</li>)}
                      </ul>
                    </div>
                    <Link href={`/products/${p.id}`} className="inline-flex h-9 items-center rounded-lg border border-line bg-white px-3 text-sm hover:border-ink">Edit</Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Categories to improve (${audit.categories.length})`}>
            {audit.categories.length === 0 ? (
              <p className="text-sm text-ok">All visible categories have descriptions.</p>
            ) : (
              <ul className="divide-y divide-line">
                {audit.categories.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{c.name}</p>
                      <ul className="mt-1 flex flex-wrap gap-1.5">
                        {c.issues.map((i) => <li key={i} className="rounded-full bg-warn/10 px-2.5 py-0.5 text-xs">{i}</li>)}
                      </ul>
                    </div>
                    <Link href="/categories" className="inline-flex h-9 items-center rounded-lg border border-line bg-white px-3 text-sm hover:border-ink">Categories</Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      <Panel title="Already done for you on the store">
        <ul className="grid gap-4 sm:grid-cols-2">
          {AUTOMATIC.map(([title, text]) => (
            <li key={title} className="text-sm">
              <p className="font-medium"><span aria-hidden className="mr-1.5 text-ok">✓</span>{title}</p>
              <p className="mt-0.5 text-muted">{text}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">
          Tip: in a product&apos;s details, “Suggest with AI” drafts a search title and description. Nothing is published until you read it and click Save.
        </p>
      </Panel>
    </div>
  );
}
