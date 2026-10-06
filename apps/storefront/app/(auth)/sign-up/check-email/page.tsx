export const metadata = { title: "Check your email", robots: { index: false } };

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="font-display text-4xl tracking-tight">Check your inbox</h1>
      <p className="mt-4 text-muted">
        We sent a confirmation link to {email ? <strong className="text-ink">{email}</strong> : "your email"}.
        Open it on this device to finish creating your account.
      </p>
    </div>
  );
}
