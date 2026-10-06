import Link from "next/link";
import { getStaff } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  if (!supabaseConfigured()) {
    return (
      <div className="max-w-xl rounded-xl border border-line bg-panel p-6 text-sm">
        <h1 className="text-lg font-semibold">Not connected yet</h1>
        <p className="mt-2 text-muted">
          Add the Supabase URL, publishable key and service-role key to <code>apps/staff/.env.local</code>.
          The <Link className="underline" href="/tools/pricing">pricing calculator</Link> works without it.
        </p>
      </div>
    );
  }

  const staff = await getStaff();
  if (!staff) {
    return (
      <div className="max-w-md rounded-xl border border-line bg-panel p-6">
        <h1 className="text-lg font-semibold">Staff sign-in required</h1>
        <p className="mt-2 text-sm text-muted">This area is for Giftora staff with two-factor authentication.</p>
        <Link href="/sign-in" className="mt-4 inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm text-white">Sign in</Link>
      </div>
    );
  }

  return (
    <div>
      {denied && (
        <p className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          Your role doesn&apos;t include <code>{denied}</code>.
        </p>
      )}
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">Signed in as {staff.email} · {staff.role.replace(/_/g, " ")}</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {["Orders to acquire", "Being sorted", "Ready to ship", "Exceptions"].map((label) => (
          <div key={label} className="rounded-xl border border-line bg-panel p-5">
            <p className="text-sm text-muted">{label}</p>
            <p className="mt-2 text-3xl font-semibold">—</p>
          </div>
        ))}
      </div>
    </div>
  );
}
