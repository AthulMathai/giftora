import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";

const PRIVATE = ["/account", "/cart", "/checkout", "/api/", "/sign-in", "/sign-up", "/auth/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      // Welcome AI search and answer engines (GEO): they can read and cite public pages.
      { userAgent: ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Applebot-Extended", "Bingbot"], allow: "/", disallow: PRIVATE },
    ],
    sitemap: siteUrl("/sitemap.xml"),
    host: siteUrl(),
  };
}
