import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { AddressForm } from "@/components/address-form";
import { Alert, Card, PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatCad } from "@/lib/format";
import { formatDate, listMyOrders, STATUS_LABEL } from "@/lib/orders";
import { createClient } from "@/lib/supabase/server";
import { deleteAddress } from "./actions";

export const metadata = { title: "Your account", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ address_error?: string }> }) {
  const user = await requireUser("/account");
  const { address_error } = await searchParams;
  const supabase = await createClient();
  const [orders, { data: profile }, { data: addresses }] = await Promise.all([
    listMyOrders(),
    supabase.from("profiles").select("full_name, email").maybeSingle(),
    supabase.from("addresses").select("id, full_name, line1, line2, city, province, postal_code").order("created_at"),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-12">
      <div className="flex items-start justify-between">
        <PageTitle sub={profile?.email ?? user.email}>Hi{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}</PageTitle>
        <form action={signOut}><button className="text-sm text-muted underline underline-offset-4">Sign out</button></form>
      </div>

      <section>
        <h2 className="font-display text-2xl">Your orders</h2>
        {orders.length === 0 ? (
          <p className="mt-4 text-muted">No orders yet. <Link href="/#shop" className="underline underline-offset-4">Find a gift</Link></p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/account/orders/${o.order_number}`} className="flex items-center justify-between gap-4 py-4 hover:text-coral">
                  <span>
                    <span className="font-medium">{o.order_number}</span>
                    <span className="ml-3 text-sm text-muted">{formatDate(o.placed_at)}</span>
                  </span>
                  <span className="text-sm">{STATUS_LABEL[o.status] ?? o.status}</span>
                  <span className="text-sm">{formatCad(o.total_cents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-14">
        <h2 className="font-display text-2xl">Addresses</h2>
        {address_error && <div className="mt-4"><Alert>Check the province and postal code (like M5H 1A1).</Alert></div>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {(addresses ?? []).map((a) => (
            <Card key={a.id} className="text-sm">
              <p className="font-medium">{a.full_name}</p>
              <p className="text-muted">{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.city}, {a.province} {a.postal_code}</p>
              <form action={deleteAddress} className="mt-3">
                <input type="hidden" name="id" value={a.id} />
                <button className="text-xs text-muted hover:text-coral">Remove</button>
              </form>
            </Card>
          ))}
        </div>
        <Card className="mt-6">
          <h3 className="mb-4 font-medium">Add an address</h3>
          <AddressForm back="/account" defaultName={profile?.full_name ?? undefined} />
        </Card>
      </section>
    </div>
  );
}
