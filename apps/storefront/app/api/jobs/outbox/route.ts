import { NextResponse } from "next/server";
import { processOutbox } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Safety net for notifications and expired checkout holds. Called by Vercel Cron (with
 * `Authorization: Bearer $CRON_SECRET`) and by the staff app after it ships an order.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data: expired } = await createAdminClient().rpc("svc_expire_checkouts");
  const result = await processOutbox(50);
  return NextResponse.json({ expired_checkouts: expired ?? 0, ...result });
}
