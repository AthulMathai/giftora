import Link from "next/link";
import { Notice } from "@/components/form";
import { requireStaff } from "@/lib/auth";
import { listCampaigns, PHASE, THEME_LABEL } from "@/lib/campaigns";
import { torontoDay } from "@/lib/time";

export const metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const staff = await requireStaff("marketing.edit");
  const { error } = await searchParams;
  const campaigns = await listCampaigns(staff.userId);
  const order = { live: 0, early: 1, upcoming: 2, ended: 3 } as const;
  const sorted = [...campaigns].sort((a, b) =>
    order[a.phase] - order[b.phase] ||
    (a.phase === "ended" ? b.ends_at.localeCompare(a.ends_at) : a.starts_at.localeCompare(b.starts_at)));

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Seasonal campaigns</h1>
          <p className="mt-1 text-sm text-muted">Halloween, Christmas, Valentine&apos;s Day and more. Each one switches on and off by itself on its dates.</p>
        </div>
        <Link href="/campaigns/new" className="inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm text-white">New campaign</Link>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}

      {sorted.length === 0 ? (
        <p className="text-sm text-muted">No campaigns yet. Create one for the next holiday.</p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((c) => (
            <li key={c.id}>
              <Link href={`/campaigns/${c.id}`} className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-panel p-4 hover:border-ink">
                <span aria-hidden className="size-10 shrink-0 rounded-lg border border-line" style={{ background: c.background_color }}>
                  <span className="m-3 block size-4 rounded-full" style={{ background: c.accent_color }} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{c.name}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PHASE[c.phase].style}`}>{PHASE[c.phase].label}</span>
                    {c.is_published
                      ? <span className="rounded-full border border-ok/40 px-2.5 py-0.5 text-xs text-ok">Published</span>
                      : <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">Draft — customers can&apos;t see it</span>}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {THEME_LABEL[c.theme] ?? c.theme}
                    {c.early_from && <> · shop early from {torontoDay(c.early_from)}</>}
                    {" · "}{torontoDay(c.starts_at)} – {torontoDay(c.ends_at)}
                  </p>
                </div>
                <span className="text-sm text-muted">{c.product_count} product{c.product_count === 1 ? "" : "s"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
