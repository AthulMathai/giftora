import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument" });

export const metadata: Metadata = {
  title: { default: "Giftora Staff", template: "%s · Giftora Staff" },
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/orders", label: "Orders" },
  { href: "/fulfillment", label: "Fulfillment" },
  { href: "/exceptions", label: "Exceptions" },
  { href: "/products", label: "Products" },
  { href: "/stock", label: "Stock check" },
  { href: "/pricing", label: "Pricing" },
  { href: "/categories", label: "Categories" },
];

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA" className={instrument.variable}>
      <body className="min-h-dvh">
        <header className="bg-ink text-white print:hidden">
          <div className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-8">
            <Link href="/" className="font-semibold tracking-tight">Giftora <span className="text-white/60 font-normal">Staff</span></Link>
            <nav className="flex gap-5 overflow-x-auto text-sm">
              {NAV.map((n) => <Link key={n.href} href={n.href} className="text-white/80 hover:text-white">{n.label}</Link>)}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8 print:p-0">{children}</main>
      </body>
    </html>
  );
}
