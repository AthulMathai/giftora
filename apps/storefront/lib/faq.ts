import type { Faq } from "./discovery";
import { POLICY } from "./policies";

/** The store-wide FAQ: used on /faq, in FAQPage structured data and in llms.txt. */
export const STORE_FAQ: { section: string; items: Faq[] }[] = [
  {
    section: "Ordering",
    items: [
      { q: "What is Giftora?", a: "Giftora is a Canadian online gift shop. We hand-pick gifts for every occasion and budget, check every item by hand, and ship across Canada." },
      { q: "Do I need an account to order?", a: "You can browse without one. To add gifts to your cart and check out, create a free account — it's how you track your order and see your order history." },
      { q: "Can I order by phone, in person or through Instagram?", a: "Yes. Contact us and our team will place the order for you. If you use the same email as your Giftora account, the order shows up in your account too." },
      { q: "Can I buy Christmas gifts early?", a: "Yes. Our Christmas collection opens early and every gift ships as soon as it's packed, so you can finish your list before the rush." },
      { q: "What payment methods do you accept?", a: "Credit and debit cards and the other options shown at checkout, processed securely by Stripe. Giftora never sees or stores your full card number." },
    ],
  },
  {
    section: "Shipping",
    items: [
      { q: "Where do you ship?", a: "Everywhere in Canada." },
      { q: "How much is shipping?", a: `Standard shipping is ${POLICY.standardShipping}. Express shipping is ${POLICY.expressShipping}.` },
      { q: "How long does delivery take?", a: `We pack orders within ${POLICY.shipsWithinBusinessDays} business days. Standard delivery then takes ${POLICY.deliveryBusinessDays} business days depending on where you are.` },
      { q: "How do I track my order?", a: "Sign in and open your order under Account. You'll see each step — paid, packed, shipped and delivered — and the tracking number once it ships. We also email you when it ships." },
    ],
  },
  {
    section: "Returns",
    items: [
      { q: "Can I return a gift?", a: `Yes, within ${POLICY.returnDays} days of delivery if it's unused and in its original packaging. Contact us with your order number to start a return.` },
      { q: "What if something arrives damaged?", a: "Tell us within a few days of delivery with a photo, and we'll replace it or refund you." },
      { q: "Are prices in Canadian dollars?", a: "Yes. All prices are in CAD. GST/HST is calculated at checkout based on the shipping province." },
    ],
  },
];
