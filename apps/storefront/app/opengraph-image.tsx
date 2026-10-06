import { ImageResponse } from "next/og";

export const alt = "Giftora — thoughtful gifts, delivered across Canada";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center",
                    padding: 80, background: "#fbf6ef", color: "#2b1b2e", fontFamily: "serif" }}>
        <div style={{ fontSize: 40, color: "#d9533b", letterSpacing: 6, textTransform: "uppercase" }}>Giftora</div>
        <div style={{ fontSize: 88, lineHeight: 1.05, marginTop: 24, maxWidth: 900 }}>Gifts they&apos;ll actually keep.</div>
        <div style={{ fontSize: 34, marginTop: 32, color: "#75636e" }}>Hand-picked, checked by hand, shipped across Canada.</div>
        <div style={{ position: "absolute", right: 80, bottom: 80, width: 180, height: 180, borderRadius: 40, background: "#d9533b", display: "flex" }} />
      </div>
    ),
    size,
  );
}
