import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Browser-sent analytics events. Only these may come from the browser; cart and checkout
// events are recorded by the server itself.
const ALLOWED = new Set(["page_view", "product_view", "search", "campaign_view"]);
const FIELDS = ["event", "visitor_id", "session_id", "path", "referrer_host", "utm_source", "utm_medium",
  "utm_campaign", "device", "product_id", "campaign_slug", "query", "results"] as const;
const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|pingdom|monitor|curl|wget|python|axios|node-fetch/i;

export async function POST(request: NextRequest) {
  const ua = request.headers.get("user-agent") ?? "";
  if (!ua || BOT.test(ua) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return new NextResponse(null, { status: 204 });
  const text = await request.text();
  if (text.length > 16_000) return new NextResponse(null, { status: 413 });
  let events: unknown;
  try { events = JSON.parse(text); } catch { return new NextResponse(null, { status: 400 }); }
  if (!Array.isArray(events)) return new NextResponse(null, { status: 400 });

  const clean = events.slice(0, 10).flatMap((e) => {
    if (!e || typeof e !== "object") return [];
    const ev = e as Record<string, unknown>;
    if (!ALLOWED.has(String(ev.event))) return [];
    return [Object.fromEntries(FIELDS.filter((f) => ev[f] !== undefined && ev[f] !== null)
      .map((f) => [f, typeof ev[f] === "number" ? ev[f] : String(ev[f]).slice(0, 512)]))];
  });
  if (clean.length) {
    const { error } = await createAdminClient().rpc("svc_track", { p_events: clean });
    if (error) console.error("[track]", error.message);
  }
  return new NextResponse(null, { status: 204 });
}
