import type { Metadata } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { JsonLd } from "@/components/json-ld";
import { SeasonMotif } from "@/components/season-art";
import { SiteHeader } from "@/components/site-header";
import { Tracker } from "@/components/tracker";
import { siteTheme } from "@/lib/campaigns";
import { organizationLd, SITE_DESCRIPTION, siteUrl, websiteLd } from "@/lib/seo";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["SOFT", "opsz"] });
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument" });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Giftora — thoughtful gifts, delivered across Canada", template: "%s · Giftora" },
  description: SITE_DESCRIPTION,
  applicationName: "Giftora",
  openGraph: { type: "website", siteName: "Giftora", locale: "en_CA" },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
};

/** Darkens a #rrggbb colour for hover states. */
function darken(hex: string, by = 0.15) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - by)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // While a season is live, it restyles the site (accent colour + ribbon); afterwards the
  // normal Giftora look returns on its own.
  const season = await siteTheme();
  const hex = /^#[0-9a-fA-F]{6}$/;
  const themeCss = season && hex.test(season.accent_color)
    ? `:root{--color-coral:${season.accent_color};--color-coral-dark:${darken(season.accent_color)}}`
    : null;

  return (
    <html lang="en-CA" className={`${fraunces.variable} ${instrument.variable}`}>
      <body className="min-h-dvh flex flex-col">
        {themeCss && <style dangerouslySetInnerHTML={{ __html: themeCss }} />}
        <JsonLd data={[organizationLd(), websiteLd()]} />
        <Suspense fallback={null}><Tracker /></Suspense>
        {season && (
          <Link href={`/seasons/${season.slug}`} className="relative block overflow-hidden px-4 py-2 text-center text-xs sm:text-sm"
                style={{ background: season.accent_color, color: "#fff" }}>
            <span className="absolute inset-0 opacity-25"><SeasonMotif theme={season.theme} color="#ffffff" /></span>
            <span className="relative font-medium">{season.eyebrow ?? season.name}: {season.headline} →</span>
          </Link>
        )}
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line mt-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12 grid gap-8 sm:grid-cols-4 text-sm">
            <div>
              <p className="font-display text-2xl">Gift<span className="text-coral">o</span>ra</p>
              <p className="mt-2 text-muted">Thoughtful gifts, checked by hand and shipped across Canada.</p>
            </div>
            <FooterCol title="Shop" links={[["All gifts", "/shop"], ["Occasions", "/occasions"], ["Seasonal", "/seasons"], ["Gifts under $50", "/gifts-under/50"]]} />
            <FooterCol title="Help" links={[["FAQ", "/faq"], ["Shipping & returns", "/shipping-returns"], ["Track an order", "/account"]]} />
            <FooterCol title="Giftora" links={[["About us", "/about"], ["Privacy", "/privacy"]]} />
          </div>
          <div className="mx-auto max-w-6xl px-4 sm:px-6 pb-10 text-xs text-muted flex flex-col sm:flex-row gap-2 justify-between">
            <p>© {new Date().getFullYear()} Giftora · Shipping across Canada</p>
            <p>All prices in CAD</p>
          </div>
        </footer>
      </body>
    </html>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <nav aria-label={title}>
      <p className="font-medium">{title}</p>
      <ul className="mt-2 space-y-1.5 text-muted">
        {links.map(([label, href]) => <li key={href}><Link href={href} className="hover:text-coral">{label}</Link></li>)}
      </ul>
    </nav>
  );
}
