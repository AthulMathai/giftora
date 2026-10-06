import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** True once the Supabase project's URL and publishable key are configured. */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 * It acts as the visitor (anon) or the signed-in customer, so row-level security
 * decides what it can see. It can never read the `internal` schema.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet) {
          try {
            for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
          } catch {
            // Called from a Server Component: cookies are read-only there; the proxy refreshes them.
          }
        },
      },
    },
  );
}
