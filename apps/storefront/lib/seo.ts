import type { Faq } from "./discovery";
import type { Product } from "./catalog";
import { POLICY } from "./policies";

export const SITE_NAME = "Giftora";
export const SITE_DESCRIPTION =
  "Giftora is a Canadian online gift shop. Hand-picked gifts for every occasion and budget, checked by hand and shipped across Canada.";

export function siteUrl(path = ""): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}

export type Crumb = { name: string; path: string };

export function breadcrumbLd(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: siteUrl(c.path) })),
  };
}

export function itemListLd(name: string, products: Product[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: products.length,
    itemListElement: products.slice(0, 30).map((p, i) => ({
      "@type": "ListItem", position: i + 1, url: siteUrl(`/products/${p.slug}`), name: p.name,
    })),
  };
}

export function faqLd(faq: Faq[]) {
  if (!faq.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

export function organizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": siteUrl("/#organization"),
    name: SITE_NAME,
    url: siteUrl("/"),
    logo: siteUrl("/icon.svg"),
    description: SITE_DESCRIPTION,
    ...(POLICY.supportEmail ? { email: POLICY.supportEmail } : {}),
    areaServed: { "@type": "Country", name: "Canada" },
    currenciesAccepted: "CAD",
    paymentAccepted: "Credit card, debit card",
    hasMerchantReturnPolicy: {
      "@type": "MerchantReturnPolicy",
      applicableCountry: "CA",
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: POLICY.returnDays,
      returnMethod: "https://schema.org/ReturnByMail",
    },
  };
}

export function websiteLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": siteUrl("/#website"),
    name: SITE_NAME,
    url: siteUrl("/"),
    inLanguage: "en-CA",
    publisher: { "@id": siteUrl("/#organization") },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${siteUrl("/shop")}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}
