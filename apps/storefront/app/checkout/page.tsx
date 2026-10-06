import { redirect } from "next/navigation";
import { AddressForm } from "@/components/address-form";
import { Alert, Card, PageTitle, SubmitButton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { cartProblems, getCart } from "@/lib/cart";
import { formatCad } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { startCheckout } from "./actions";

export const metadata = { title: "Checkout", robots: { index: false } };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  empty: "Your cart is empty.",
  address: "Choose a shipping address.",
  shipping: "Choose a shipping method.",
  unavailable: "Something in your cart is no longer available.",
  stock: "Something in your cart just sold out or has fewer left than you chose.",
  failed: "We couldn't start checkout. Please try again.",
};

interface ShippingMethod { code: string; name: string; cents: number; free_over_cents: number | null }

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ error?: string; address?: string }> }) {
  await requireUser("/checkout");
  const { error, address: newAddressId } = await searchParams;
  const { lines, subtotalCents } = await getCart();
  if (lines.length === 0) redirect("/cart");
  if (cartProblems(lines).length > 0) redirect("/cart");

  const supabase = await createClient();
  const { data: addresses } = await supabase
    .from("addresses")
    .select("id, full_name, line1, line2, city, province, postal_code, is_default_shipping")
    .order("created_at");
  const { data: methodsJson } = await createAdminClient().rpc("svc_get_setting", { p_key: "shipping.methods" });
  const methods = (methodsJson ?? []) as ShippingMethod[];
  const selectedAddress = newAddressId ?? addresses?.find((a) => a.is_default_shipping)?.id ?? addresses?.[0]?.id;

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-12">
      <PageTitle>Checkout</PageTitle>
      {error && ERRORS[error] && <div className="mb-6"><Alert>{ERRORS[error]}</Alert></div>}

      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="space-y-8">
          {(addresses ?? []).length > 0 ? (
            <form id="checkout" action={startCheckout} className="space-y-8">
              <fieldset>
                <legend className="font-display text-2xl">Ship to</legend>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {(addresses ?? []).map((a) => (
                    <label key={a.id} className="cursor-pointer rounded-2xl border border-line bg-paper p-4 text-sm has-[:checked]:border-ink has-[:checked]:ring-1 has-[:checked]:ring-ink">
                      <input type="radio" name="address_id" value={a.id} defaultChecked={a.id === selectedAddress} className="sr-only" required />
                      <span className="font-medium">{a.full_name}</span>
                      <span className="block text-muted">{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.city}, {a.province} {a.postal_code}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="font-display text-2xl">Delivery</legend>
                <div className="mt-4 space-y-3">
                  {methods.map((m, i) => {
                    const free = m.free_over_cents !== null && subtotalCents >= m.free_over_cents;
                    return (
                      <label key={m.code} className="flex cursor-pointer items-center justify-between rounded-2xl border border-line bg-paper p-4 text-sm has-[:checked]:border-ink has-[:checked]:ring-1 has-[:checked]:ring-ink">
                        <span className="flex items-center gap-3">
                          <input type="radio" name="shipping_method" value={m.code} defaultChecked={i === 0} required className="accent-ink" />
                          {m.name}
                        </span>
                        <span>{free ? "Free" : formatCad(m.cents)}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </form>
          ) : (
            <p className="text-muted">Add a shipping address to continue.</p>
          )}

          <details className="rounded-2xl border border-line bg-paper p-5" open={(addresses ?? []).length === 0}>
            <summary className="cursor-pointer font-medium">Add a new address</summary>
            <div className="mt-5"><AddressForm back="/checkout" /></div>
          </details>
        </div>

        <aside className="h-fit">
          <Card>
            <ul className="space-y-3 text-sm">
              {lines.map((l) => (
                <li key={l.variant_id} className="flex justify-between gap-3">
                  <span>{l.product.name}<span className="block text-muted">{l.label} × {l.quantity}</span></span>
                  <span>{formatCad((l.price_cents ?? 0) * l.quantity)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-between border-t border-line pt-4 text-sm">
              <span>Subtotal</span><span>{formatCad(subtotalCents)}</span>
            </div>
            <p className="mt-1 text-xs text-muted">Shipping and tax are added on the next step.</p>
            {(addresses ?? []).length > 0 && (
              <SubmitButton form="checkout" className="mt-6 w-full">Continue to payment</SubmitButton>
            )}
            <p className="mt-3 text-xs text-muted">We hold your items for 15 minutes while you pay.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
