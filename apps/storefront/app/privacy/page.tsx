import type { Metadata } from "next";
import { ProsePage } from "@/components/prose-page";
import { POLICY } from "@/lib/policies";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Giftora collects, why, and how we protect it.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <ProsePage title="Privacy" path="/privacy" intro="Plain-language summary of what we collect and why.">
      <h2>What we collect</h2>
      <ul>
        <li><strong>Your account:</strong> name, email, phone (optional) and saved addresses, so we can deliver your orders.</li>
        <li><strong>Your orders:</strong> what you bought, where it ships and its status.</li>
        <li><strong>Payments:</strong> handled by Stripe. We never see or store your full card number.</li>
        <li><strong>How the shop is used:</strong> pages viewed, searches and cart activity, linked to a random ID stored in a cookie on your device. We don&apos;t store your IP address and don&apos;t use third-party advertising trackers. If your browser sends Do Not Track or Global Privacy Control, we don&apos;t record this at all.</li>
      </ul>
      <h2>Why</h2>
      <p>To fulfil and support your orders, keep your account secure, and improve which gifts we carry and how the shop works. We don&apos;t sell your personal information.</p>
      <h2>Who we share it with</h2>
      <p>Only the services needed to run the shop: our payment processor (Stripe), our hosting and database providers, our email provider, and the carrier delivering your parcel.</p>
      <h2>Your choices</h2>
      <p>You can update your details in your account, and ask us to access or delete your personal information{POLICY.supportEmail ? <> by emailing <a href={`mailto:${POLICY.supportEmail}`}>{POLICY.supportEmail}</a></> : null}.</p>
    </ProsePage>
  );
}
