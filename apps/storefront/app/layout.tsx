import type { Metadata } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["SOFT", "opsz"] });
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument" });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Giftora — thoughtful gifts, delivered across Canada", template: "%s · Giftora" },
  description:
    "Find a gift they'll actually keep. Hand-picked gifts for every occasion and budget, shipped across Canada.",
  openGraph: { type: "website", siteName: "Giftora", locale: "en_CA" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA" className={`${fraunces.variable} ${instrument.variable}`}>
      <body className="min-h-dvh flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line mt-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 text-sm text-muted flex flex-col sm:flex-row gap-2 justify-between">
            <p>© {new Date().getFullYear()} Giftora · Shipping across Canada</p>
            <p>Prices in CAD</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
