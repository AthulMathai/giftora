import Link from "next/link";
import { Alert, Card, Field, SubmitButton } from "@/components/ui";
import { safeNext } from "@/lib/auth";
import { signIn } from "../actions";

export const metadata = { title: "Sign in", robots: { index: false } };

const ERRORS: Record<string, string> = {
  invalid: "That email and password don't match.",
  unconfirmed: "Please confirm your email first — check your inbox for the link.",
  link: "That link has expired. Sign in, or create your account again.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const target = safeNext(next);
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-4xl tracking-tight">Welcome back</h1>
      <p className="mt-2 text-muted">Sign in to fill your cart and follow your orders.</p>
      <Card className="mt-8">
        <form action={signIn} className="space-y-4">
          {error && ERRORS[error] && <Alert>{ERRORS[error]}</Alert>}
          <input type="hidden" name="next" value={target} />
          <Field label="Email" name="email" type="email" autoComplete="email" required />
          <Field label="Password" name="password" type="password" autoComplete="current-password" required />
          <SubmitButton className="w-full">Sign in</SubmitButton>
        </form>
      </Card>
      <p className="mt-6 text-center text-sm text-muted">
        New to Giftora?{" "}
        <Link href={`/sign-up?next=${encodeURIComponent(target)}`} className="text-ink underline underline-offset-4">Create an account</Link>
      </p>
    </div>
  );
}
