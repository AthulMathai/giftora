import Link from "next/link";
import { Alert, PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { cartProblems, getCart } from "@/lib/cart";
import { formatCad } from "@/lib/format";
import { removeFromCart, updateQuantity } from "./actions";

export const metadata = { title: "Your cart", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CartPage({ searchParams }: { searchParams: Promise<{ added?: string }> }) {
  await requireUser("/cart");
  const { added } = await searchParams;
  const { lines, subtotalCents } = await getCart();
  const problems = cartProblems(lines);

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-12">
      <PageTitle>Your cart</PageTitle>
      {added && <div className="mb-6"><Alert tone="info">Added to your cart.</Alert></div>}

      {lines.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-muted">Your cart is empty.</p>
          <Link href="/#shop" className="mt-4 inline-block underline underline-offset-4">Find a gift</Link>
        </div>
      ) : (
        <div className="grid gap-10 lg:grid-cols-[1fr_300px]">
          <ul className="divide-y divide-line border-y border-line">
            {lines.map((l) => (
              <li key={l.variant_id} className="flex gap-4 py-5">
                <div className="size-20 shrink-0 rounded-xl bg-linear-to-br from-[#f3d9c9] to-[#e9b9a4] grid place-items-center font-display text-3xl text-ink/25">
                  {l.product.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <Link href={`/products/${l.product.slug}`} className="font-medium hover:text-coral">{l.product.name}</Link>
                  <p className="text-sm text-muted">{l.label} · <span className="font-mono text-xs">{l.sku}</span></p>
                  <div className="mt-3 flex items-center gap-3">
                    <form action={updateQuantity} className="flex items-center gap-2">
                      <input type="hidden" name="variant_id" value={l.variant_id} />
                      <label className="sr-only" htmlFor={`q-${l.variant_id}`}>Quantity</label>
                      <select id={`q-${l.variant_id}`} name="quantity" defaultValue={l.quantity}
                              className="rounded-lg border border-line bg-paper px-2 py-1 text-sm">
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <button className="text-sm underline underline-offset-4">Update</button>
                    </form>
                    <form action={removeFromCart}>
                      <input type="hidden" name="variant_id" value={l.variant_id} />
                      <button className="text-sm text-muted hover:text-coral">Remove</button>
                    </form>
                  </div>
                </div>
                <p className="text-right whitespace-nowrap">{formatCad((l.price_cents ?? 0) * l.quantity)}</p>
              </li>
            ))}
          </ul>

          <aside className="h-fit rounded-2xl border border-line bg-paper p-6">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatCad(subtotalCents)}</dd></div>
              <div className="flex justify-between text-muted"><dt>Shipping</dt><dd>At checkout</dd></div>
              <div className="flex justify-between text-muted"><dt>Tax</dt><dd>At checkout</dd></div>
            </dl>
            {problems.length > 0 && (
              <div className="mt-4 space-y-2">{problems.map((p) => <Alert key={p}>{p}</Alert>)}</div>
            )}
            {problems.length === 0 ? (
              <Link href="/checkout" className="mt-6 flex h-12 items-center justify-center rounded-full bg-ink text-cream hover:bg-coral">
                Checkout
              </Link>
            ) : (
              <p className="mt-6 text-sm text-muted">Fix the items above to check out.</p>
            )}
            <p className="mt-3 text-xs text-muted">Free standard shipping on orders over $75.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
