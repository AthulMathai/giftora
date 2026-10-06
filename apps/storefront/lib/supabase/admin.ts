import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for the storefront's server code (Stripe webhook, payment setup,
 * notification worker). It may ONLY call the `svc_*` database functions — never query
 * tables for a customer request; customer reads go through the RLS client.
 * `server-only` breaks the build if this is ever imported into browser code.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
