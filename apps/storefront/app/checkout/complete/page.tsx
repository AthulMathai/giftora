import Link from "next/link";
import { PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatCad } from "@/lib/format";
import { ORDER_COLUMNS, type OrderSummary } from "@/lib/orders";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Thank you", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CompletePage({ searchParams }: {
  searchParams: Promise<{ order?: string; redirect_status?: string }>;
}) {
  const { order: number, redirect_status } = await searchParams;
  await requireUser(`/checkout/complete?order=${number ?? ""}`);
  const supabase = await createClient();
  const { data } = await supabase.from("orders").select(ORDER_COLUMNS).eq("order_number", number ?? "").maybeSingle();
  const order = data as unknown as OrderSummary | null;

  if (!order || redirect_status === "failed") {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <PageTitle>Payment didn&apos;t go through</PageTitle>
        <p className="text-muted">You haven&apos;t been charged. Your cart is still saved.</p>
        <Link href="/checkout" className="mt-6 inline-block underline underline-offset-4">Try again</Link>
      </div>
    );
  }

  const paid = order.payment_status === "captured";
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <p className="text-sm uppercase tracking-[0.18em] text-coral">Order {order.order_number}</p>
      <h1 className="mt-3 font-display text-5xl tracking-tight">Thank you!</h1>
      <p className="mt-5 text-lg text-muted">
        {paid
          ? `We've received your payment of ${formatCad(order.total_cents)}. A confirmation is on its way to ${order.email}.`
          : `Your payment of ${formatCad(order.total_cents)} is being confirmed. This usually takes a few seconds; we'll email ${order.email} as soon as it's done.`}
      </p>
      <p className="mt-3 text-muted">We pick every gift by hand and ship within 3 business days.</p>
      <div className="mt-8 flex justify-center gap-4">
        <Link href={`/account/orders/${order.order_number}`} className="inline-flex h-12 items-center rounded-full bg-ink px-7 text-cream hover:bg-coral">View order</Link>
        <Link href="/#shop" className="inline-flex h-12 items-center rounded-full border border-line px-7">Keep shopping</Link>
      </div>
    </div>
  );
}
