import type { Metadata } from "next";
import Link from "next/link";
import { ProsePage } from "@/components/prose-page";

export const metadata: Metadata = {
  title: "About Giftora",
  description: "Giftora is a Canadian gift shop that hand-picks, checks and ships thoughtful gifts across Canada.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <ProsePage title="About Giftora" path="/about" intro="Gifts they'll actually keep, found for you.">
      <p>Giftora is an online gift shop based in Canada. We look for gifts that are useful, good-looking and a little bit special, then make finding the right one easy: shop by occasion, by who it&apos;s for, or by budget — or just describe the person and let us suggest ideas.</p>
      <h2>How we work</h2>
      <ul>
        <li><strong>Hand-picked.</strong> Every gift is chosen by our team, not pulled from an endless catalogue.</li>
        <li><strong>Checked by hand.</strong> Each item is inspected and scanned into its own order bin before it&apos;s packed, so the right gift goes to the right person.</li>
        <li><strong>Tracked end to end.</strong> You can follow your order from paid to packed to delivered in your account.</li>
        <li><strong>Seasonal collections.</strong> Christmas, Valentine&apos;s Day, Mother&apos;s and Father&apos;s Day and more — many open early so you can shop ahead.</li>
      </ul>
      <h2>Shipping across Canada</h2>
      <p>We ship to every province and territory. See <Link href="/shipping-returns">shipping &amp; returns</Link> for prices and timing, or our <Link href="/faq">FAQ</Link>.</p>
    </ProsePage>
  );
}
