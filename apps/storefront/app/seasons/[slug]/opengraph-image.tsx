import { ImageResponse } from "next/og";
import { getCampaign } from "@/lib/campaigns";

export const alt = "Giftora seasonal gifts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function SeasonOg({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getCampaign((await params).slug);
  const bg = c?.background_color ?? "#fbf6ef", ink = c?.ink_color ?? "#2b1b2e", accent = c?.accent_color ?? "#d9533b";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center",
                    padding: 80, background: bg, color: ink, fontFamily: "serif", position: "relative" }}>
        <div style={{ position: "absolute", right: -80, top: -80, width: 420, height: 420, borderRadius: 999, background: accent, opacity: 0.9, display: "flex" }} />
        <div style={{ position: "absolute", right: 220, bottom: 60, width: 140, height: 140, borderRadius: 999, background: accent, opacity: 0.4, display: "flex" }} />
        <div style={{ fontSize: 34, color: accent, letterSpacing: 6, textTransform: "uppercase" }}>{`Giftora · ${c?.name ?? "Seasonal gifts"}`}</div>
        <div style={{ fontSize: 84, lineHeight: 1.05, marginTop: 24, maxWidth: 820 }}>{c?.headline ?? "Gifts for every season"}</div>
        {c?.subheadline && <div style={{ fontSize: 32, marginTop: 28, maxWidth: 800, opacity: 0.8 }}>{c.subheadline}</div>}
      </div>
    ),
    size,
  );
}
