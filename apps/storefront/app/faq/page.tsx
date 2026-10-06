import type { Metadata } from "next";
import { ProsePage } from "@/components/prose-page";
import { STORE_FAQ } from "@/lib/faq";
import { faqLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description: "Answers about ordering, shipping across Canada, tracking, payments and returns at Giftora.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  return (
    <ProsePage title="Frequently asked questions" path="/faq" extraLd={faqLd(STORE_FAQ.flatMap((s) => s.items))}>
      {STORE_FAQ.map((s) => (
        <section key={s.section}>
          <h2>{s.section}</h2>
          <dl className="mt-4 divide-y divide-line border-y border-line">
            {s.items.map((f) => (
              <div key={f.q} className="py-5">
                <dt className="font-medium">{f.q}</dt>
                <dd className="mt-2 text-muted">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </ProsePage>
  );
}
