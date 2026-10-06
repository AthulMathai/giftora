import Link from "next/link";
import { Alert, Card, Field, SubmitButton } from "@/components/ui";
import { safeNext } from "@/lib/auth";
import { signUp } from "../actions";

export const metadata = { title: "Create an account", robots: { index: false } };

const ERRORS: Record<string, string> = {
  short: "Use at least 10 characters for your password.",
  failed: "We couldn't create that account. If you already have one, sign in instead.",
};

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const target = safeNext(next);
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-4xl tracking-tight">Create your account</h1>
      <p className="mt-2 text-muted">You&apos;ll use it to check out, track orders and save gift ideas.</p>
      <Card className="mt-8">
        <form action={signUp} className="space-y-4">
          {error && ERRORS[error] && <Alert>{ERRORS[error]}</Alert>}
          <input type="hidden" name="next" value={target} />
          <Field label="Your name" name="full_name" autoComplete="name" required />
          <Field label="Email" name="email" type="email" autoComplete="email" required />
          <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={10} required
                 hint="At least 10 characters." />
          <SubmitButton className="w-full">Create account</SubmitButton>
        </form>
      </Card>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href={`/sign-in?next=${encodeURIComponent(target)}`} className="text-ink underline underline-offset-4">Sign in</Link>
      </p>
    </div>
  );
}
