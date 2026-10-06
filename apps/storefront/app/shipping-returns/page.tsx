import type { Metadata } from "next";
import { ProsePage } from "@/components/prose-page";
import { POLICY } from "@/lib/policies";

export const metadata: Metadata = {
  title: "Shipping & returns",
  description: `Giftora ships across Canada. Standard shipping ${POLICY.standardShipping}. Returns within ${POLICY.returnDays} days.`,
  alternates: { canonical: "/shipping-returns" },
};

export default function ShippingPage() {
  return (
    <ProsePage title="Shipping & returns" path="/shipping-returns">
      <h2>Shipping</h2>
      <ul>
        <li>We ship everywhere in Canada.</li>
        <li><strong>Standard:</strong> {POLICY.standardShipping}. Arrives in about {POLICY.deliveryBusinessDays} business days after it ships.</li>
        <li><strong>Express:</strong> {POLICY.expressShipping}.</li>
        <li>Orders are checked by hand and packed within {POLICY.shipsWithinBusinessDays} business days.</li>
        <li>You&apos;ll see your order marked <em>Packed</em> and then <em>Shipped</em> with a tracking number in your account, and we email you when it ships.</li>
      </ul>
      <h2>Returns</h2>
      <ul>
        <li>Return unused gifts in their original packaging within {POLICY.returnDays} days of delivery.</li>
        <li>If something arrives damaged or isn&apos;t what you ordered, tell us with a photo and we&apos;ll make it right.</li>
        <li>Refunds go back to your original payment method once we receive the return.</li>
        {POLICY.supportEmail && <li>To start a return, email <a href={`mailto:${POLICY.supportEmail}`}>{POLICY.supportEmail}</a> with your order number.</li>}
      </ul>
      <h2>Taxes</h2>
      <p>Prices are in Canadian dollars. GST/HST is added at checkout based on the province you&apos;re shipping to.</p>
    </ProsePage>
  );
}
