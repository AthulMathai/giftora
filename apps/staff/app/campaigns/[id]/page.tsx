import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignForm } from "@/components/campaign-form";
import { Notice } from "@/components/form";
import { requireStaff } from "@/lib/auth";
import { getCampaign, PHASE, pickableProducts } from "@/lib/campaigns";
import { torontoDay } from "@/lib/time";

export const metadata = { title: "Edit campaign" };
export const dynamic = "force-dynamic";

export default async function EditCampaignPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const staff = await requireStaff("marketing.edit");
  const { id } = await params;
  const { error, saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const campaign = await getCampaign(staff.userId, id);
  if (!campaign) notFound();
  const products = await pickableProducts(campaign.pinned ?? []);
  const phase = PHASE[campaign.phase];

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/campaigns" className="text-sm text-muted hover:text-ink">← Campaigns</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${phase.style}`}>{phase.label}</span>
          {!campaign.is_published && <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">Draft</span>}
        </div>
        <p className="mt-1 text-sm text-muted">{torontoDay(campaign.starts_at)} – {torontoDay(campaign.ends_at)} (Toronto time)</p>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {saved && !error && (
        <Notice tone="ok">
          Campaign saved.{" "}
          {campaign.is_published ? "Customers will see it on its dates." : "It's still a draft, so customers can't see it yet."}
        </Notice>
      )}
      <CampaignForm key={campaign.updated_at} campaign={campaign} products={products} />
    </div>
  );
}
