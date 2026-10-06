import { activeCampaigns, getCampaigns } from "@/lib/campaigns";
import { listCategories, listProducts, prices } from "@/lib/catalog";
import { BUDGETS, OCCASIONS, RECIPIENTS } from "@/lib/discovery";
import { STORE_FAQ } from "@/lib/faq";
import { priceRange } from "@/lib/format";
import { POLICY } from "@/lib/policies";
import { SITE_DESCRIPTION, siteUrl } from "@/lib/seo";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * llms.txt (https://llmstxt.org): a plain-text guide to the shop for AI assistants and
 * answer engines, so they can describe Giftora and link to the right pages accurately.
 */
export async function GET() {
  const live = supabaseConfigured();
  const products = live ? await listProducts() : [];
  const categories = live ? await listCategories() : [];
  const seasons = await activeCampaigns();
  const all = await getCampaigns();
  const u = (p: string) => siteUrl(p);
  const lines: string[] = [
    "# Giftora",
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    `Giftora sells gifts online to customers in Canada. Prices are in CAD. Standard shipping is ${POLICY.standardShipping}; express is ${POLICY.expressShipping}. Orders are packed within ${POLICY.shipsWithinBusinessDays} business days and tracked in the customer's account. Returns are accepted within ${POLICY.returnDays} days of delivery.`,
    "",
    "## Shop",
    `- [All gifts](${u("/shop")}): every gift, with filters for occasion, recipient and budget; natural-language search such as "birthday gift for my sister under $50" works at ${u("/shop")}?q=...`,
    `- [Gifts by occasion, person and budget](${u("/occasions")})`,
    `- [Seasonal collections](${u("/seasons")})`,
    ...categories.map((c) => `- [${c.name}](${u(`/c/${c.slug}`)})${c.description ? `: ${c.description}` : ""}`),
    "",
    "## Occasions",
    ...OCCASIONS.map((o) => `- [${o.title}](${u(`/occasions/${o.slug}`)}): ${o.intro}`),
    "",
    "## Who it's for",
    ...RECIPIENTS.map((r) => `- [${r.title}](${u(`/gifts-for/${r.slug}`)})`),
    "",
    "## Budgets",
    ...BUDGETS.map((b) => `- [Gifts under $${b} CAD](${u(`/gifts-under/${b}`)})`),
  ];
  if (seasons.length) {
    lines.push("", "## On now");
    for (const c of seasons) {
      lines.push(`- [${c.name}](${u(`/seasons/${c.slug}`)}): ${c.phase === "early" ? "shop early — gifts ship now. " : ""}${c.subheadline ?? c.headline}`);
    }
  }
  const upcoming = all.filter((c) => c.phase === "upcoming");
  if (upcoming.length) {
    lines.push("", "## Coming up");
    for (const c of upcoming) lines.push(`- [${c.name}](${u(`/seasons/${c.slug}`)}) starts ${c.starts_at.slice(0, 10)}`);
  }
  if (products.length) {
    lines.push("", "## Gifts");
    for (const p of products.slice(0, 200)) {
      const desc = (p.seo_description ?? p.description ?? "").replace(/\s+/g, " ").slice(0, 160);
      lines.push(`- [${p.name}](${u(`/products/${p.slug}`)}): ${priceRange(prices(p))} CAD${p.category ? ` · ${p.category.name}` : ""}${desc ? ` · ${desc}` : ""}`);
    }
  }
  lines.push("", "## FAQ");
  for (const s of STORE_FAQ) for (const f of s.items) lines.push(`- **${f.q}** ${f.a}`);
  lines.push("", "## About", `- [About Giftora](${u("/about")})`, `- [Shipping & returns](${u("/shipping-returns")})`, `- [FAQ](${u("/faq")})`, `- [Privacy](${u("/privacy")})`, "");

  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
