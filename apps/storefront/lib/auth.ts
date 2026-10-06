import "server-only";
import { redirect } from "next/navigation";
import { createClient, supabaseConfigured } from "./supabase/server";

export async function getUser() {
  if (!supabaseConfigured()) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** Sends visitors to sign in, then back to `next`. */
export async function requireUser(next: string) {
  const user = await getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  return user;
}

/** Only allow same-site relative redirects (prevents open-redirect abuse of ?next=). */
export function safeNext(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  return next;
}
