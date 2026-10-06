import type { Metadata } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import Link from "next/link";
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
        <header className="border-b border-line bg-cream/90 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
            <Link href="/" className="font-display text-2xl tracking-tight">
              Gift<span className="text-coral">o</span>ra
            </Link>
            <nav className="flex items-center gap-5 text-sm">
              <Link href="/#shop" className="hover:text-coral">Shop</Link>
              <span className="text-muted hidden sm:inline" title="Coming soon">Gift finder</span>
              <span className="text-muted" title="Accounts arrive next">Sign in</span>
            </nav>
          </div>
        </header>
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
