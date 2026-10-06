import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaffState } from "@/lib/auth";
import { staffOrders } from "@/lib/orders";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  if (!supabaseConfigured()) {
    return (
      <div className="max-w-xl rounded-xl border border-line bg-panel p-6 text-sm">
        <h1 className="text-lg font-semibold">Not connected yet</h1>
        <p className="mt-2 text-muted">
          Add the Supabase URL, publishable key and service-role key to the staff app&apos;s environment.
          The <Link className="underline" href="/tools/pricing">pricing calculator</Link> works without it.
        </p>
      </div>
    );
  }

  const state = await getStaffState();
  if (state.kind === "needs_mfa") redirect("/mfa");
  if (state.kind !== "ok") {
    return (
      <div className="max-w-md rounded-xl border border-line bg-panel p-6">
        <h1 className="text-lg font-semibold">Staff sign-in required</h1>
        <p className="mt-2 text-sm text-muted">This area is for Giftora staff with two-factor authentication.</p>
        <Link href="/sign-in" className="mt-4 inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm text-white">Sign in</Link>
      </div>
    );
  }
  const staff = state.staff;
  const orders = staff.can("orders.view") ? await staffOrders(staff.userId) : [];
  const count = (s: string[]) => orders.filter((o) => s.includes(o.status)).length;
  let staleCount = 0;
  if (staff.can("suppliers.view")) {
    const { data } = await createAdminClient().rpc("svc_stock_list", { p_actor: staff.userId });
    staleCount = ((data ?? []) as { stale: boolean }[]).filter((r) => r.stale).length;
  }
  const tiles = [
    { label: "New — to acquire", value: count(["paid"]), href: "/orders?status=paid" },
    { label: "Being prepared", value: count(["processing"]), href: "/orders?status=processing" },
    { label: "Shipped", value: count(["shipped"]), href: "/orders?status=shipped" },
    { label: "Delivered", value: count(["delivered"]), href: "/orders?status=delivered" },
  ];

  return (
    <div>
      {denied && (
        <p className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          Your role doesn&apos;t include <code>{denied}</code>.
        </p>
      )}
      {staleCount > 0 && (
        <Link href="/stock?show=stale" className="mb-6 block rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <strong>{staleCount} item{staleCount === 1 ? "" : "s"}</strong> haven&apos;t had a stock check in 72 hours and are hidden from sale. Check them →
        </Link>
      )}
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">Signed in as {staff.email} · {staff.role.replace(/_/g, " ")}</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-xl border border-line bg-panel p-5 hover:border-ink">
            <p className="text-sm text-muted">{t.label}</p>
            <p className="mt-2 text-3xl font-semibold">{t.value}</p>
          </Link>
        ))}
      </div>
      {staff.can("fulfillment.operate") && (
        <Link href="/pick-list" className="mt-8 inline-flex h-11 items-center rounded-lg bg-ink px-5 text-sm text-white">
          Open today&apos;s pick list
        </Link>
      )}
    </div>
  );
}
