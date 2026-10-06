import type { Metadata } from "next";
import Link from "next/link";
import { SeasonArt } from "@/components/season-art";
import { getCampaigns, seasonDates } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Seasonal gifts",
  description: "Gifts for every season: Christmas, Halloween, Valentine's Day, Mother's Day, Father's Day and more, shipped across Canada.",
  alternates: { canonical: "/seasons" },
};

const LABEL = { live: "On now", early: "Shop early", upcoming: "Coming soon", ended: "Back next year" } as const;

export default async function SeasonsPage() {
  const all = await getCampaigns();
  const order = { live: 0, early: 1, upcoming: 2, ended: 3 } as const;
  const seasons = [...all].sort((a, b) => order[a.phase] - order[b.phase] || Date.parse(a.starts_at) - Date.parse(b.starts_at));
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
      <h1 className="font-display text-4xl sm:text-5xl tracking-tight">Seasonal gifts</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">Every holiday has its own collection. Many open early, so you can shop ahead of the rush.</p>
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {seasons.map((c) => (
          <Link key={c.slug} href={`/seasons/${c.slug}`} className="group relative block h-56 overflow-hidden rounded-3xl"
                style={{ background: c.background_color, color: c.ink_color }}>
            <SeasonArt theme={c.theme} accent={c.accent_color} ink={c.ink_color} bg={c.background_color}
                       className="absolute inset-0 h-full w-full opacity-60 transition group-hover:opacity-90" />
            <div className="relative p-6">
              <span className="rounded-full px-3 py-1 text-xs font-medium text-white" style={{ background: c.accent_color }}>{LABEL[c.phase]}</span>
              <h2 className="mt-4 font-display text-3xl">{c.name}</h2>
              <p className="mt-1 text-sm opacity-80">{seasonDates(c)}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
