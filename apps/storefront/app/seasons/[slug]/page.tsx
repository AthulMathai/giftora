import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Listing } from "@/components/listing";
import { SeasonHero } from "@/components/season";
import { TrackCampaign } from "@/components/tracker";
import { campaignProducts, getCampaign, getCampaigns, seasonDates } from "@/lib/campaigns";
import { parseSort, sortProducts } from "@/lib/listing";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ sort?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await getCampaign((await params).slug);
  if (!c) return {};
  const title = c.seo_title ?? `${c.name} gifts`;
  const description = c.seo_description ?? c.subheadline ?? undefined;
  return {
    title, description,
    alternates: { canonical: `/seasons/${c.slug}` },
    openGraph: { title, description },
  };
}

export default async function SeasonPage({ params, searchParams }: Props) {
  const c = await getCampaign((await params).slug);
  if (!c) notFound();
  const sort = parseSort((await searchParams).sort);
  const products = c.phase === "upcoming" ? [] : sortProducts(await campaignProducts(c), sort);
  const others = (await getCampaigns()).filter((x) => x.slug !== c.slug && (x.phase === "live" || x.phase === "early"));

  return (
    <Listing
      title={`${c.name} gifts`}
      sort={sort}
      products={products}
      faq={c.faq}
      crumbs={[{ name: "Home", path: "/" }, { name: "Seasons", path: "/seasons" }, { name: c.name, path: `/seasons/${c.slug}` }]}
      banner={<div className="mt-6"><SeasonHero c={c} headingLevel="h1" /></div>}
      empty={
        c.phase === "upcoming" ? <p>Our {c.name} gifts arrive soon. Check back closer to {seasonDates(c).split(" – ")[0]}.</p>
        : c.phase === "ended" ? <p>{c.name} is over for this year. <Link href="/shop" className="underline">Browse all gifts</Link>.</p>
        : undefined
      }
    >
      <TrackCampaign slug={c.slug} />
      <div className="mt-6 max-w-2xl space-y-3 text-muted">
        {c.body && <p className="text-lg">{c.body}</p>}
        <p className="text-sm">
          {c.phase === "early" ? `Shop early: ${c.name} runs ${seasonDates(c)}, but these gifts ship now.`
            : c.phase === "live" ? `${c.name} runs ${seasonDates(c)}.`
            : c.phase === "ended" ? `${c.name} ran ${seasonDates(c)}.`
            : `${c.name} starts ${seasonDates(c).split(" – ")[0]}.`}
        </p>
        {others.length > 0 && (
          <p className="text-sm">Also on now: {others.map((o, i) => (
            <span key={o.slug}>{i > 0 && ", "}<Link href={`/seasons/${o.slug}`} className="underline">{o.name}</Link></span>
          ))}</p>
        )}
      </div>
    </Listing>
  );
}
