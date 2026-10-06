"use server";

import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const reason = error.code === "email_not_confirmed" ? "unconfirmed" : "invalid";
    redirect(`/sign-in?error=${reason}&next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export async function signUp(formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  if (password.length < 10) redirect(`/sign-up?error=short&next=${encodeURIComponent(next)}`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) redirect(`/sign-up?error=failed&next=${encodeURIComponent(next)}`);
  // With email confirmation on, there is no session yet: ask them to check their inbox.
  if (!data.session) redirect(`/sign-up/check-email?email=${encodeURIComponent(email)}`);
  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
