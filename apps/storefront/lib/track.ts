import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "./supabase/admin";

/**
 * Server-side analytics events (add to cart, checkout started) tagged with the visitor's
 * analytics cookies. Never throws: a tracking failure must not break a purchase.
 */
export async function trackServer(event: "add_to_cart" | "begin_checkout" | "sign_up", data: Record<string, unknown> = {}) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    const jar = await cookies();
    const visitor = jar.get("gv")?.value;
    const session = jar.get("gs")?.value;
    if (!visitor || !session) return; // opted out (Do Not Track) or cookies blocked
    await createAdminClient().rpc("svc_track", {
      p_events: [{ event, visitor_id: visitor, session_id: session, ...data }],
    });
  } catch (e) {
    console.error("[track]", e);
  }
}
