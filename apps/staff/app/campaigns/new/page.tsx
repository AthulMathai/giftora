import Link from "next/link";
import { CampaignForm } from "@/components/campaign-form";
import { Notice } from "@/components/form";
import { requireStaff } from "@/lib/auth";
import { pickableProducts } from "@/lib/campaigns";

export const metadata = { title: "New campaign" };
export const dynamic = "force-dynamic";

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireStaff("marketing.edit");
  const { error } = await searchParams;
  const products = await pickableProducts();
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/campaigns" className="text-sm text-muted hover:text-ink">← Campaigns</Link>
        <h1 className="mt-2 text-2xl font-semibold">New campaign</h1>
        <p className="mt-1 text-sm text-muted">New campaigns start as drafts. Tick “Published” when it&apos;s ready.</p>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      <CampaignForm products={products} />
    </div>
  );
}
