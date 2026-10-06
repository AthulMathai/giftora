import { redirect } from "next/navigation";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";

export const metadata = { title: "Sign in" };

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // Never say which part was wrong.
  if (error) redirect("/sign-in?error=1");
  redirect("/");
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <form action={signIn} className="mx-auto mt-10 max-w-sm rounded-xl border border-line bg-panel p-6">
      <h1 className="text-lg font-semibold">Staff sign-in</h1>
      {!supabaseConfigured() && <p className="mt-2 text-sm text-warn">Supabase isn&apos;t configured yet.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-bad">That email and password didn&apos;t match.</p>}
      <label className="mt-5 block text-sm">
        Email
        <input name="email" type="email" required autoComplete="username"
               className="mt-1 block w-full rounded-lg border border-line px-3 py-2" />
      </label>
      <label className="mt-4 block text-sm">
        Password
        <input name="password" type="password" required autoComplete="current-password"
               className="mt-1 block w-full rounded-lg border border-line px-3 py-2" />
      </label>
      <button className="mt-6 h-10 w-full rounded-lg bg-ink text-sm text-white">Continue</button>
      <p className="mt-4 text-xs text-muted">A second factor (authenticator app) is required after this step.</p>
    </form>
  );
}
