import Link from "next/link";
import { redirect } from "next/navigation";
import { PaymentForm } from "@/components/payment-form";
import { Alert, Card, PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatCad } from "@/lib/format";
import { ORDER_COLUMNS, type OrderSummary } from "@/lib/orders";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Payment", robots: { index: false } };
export const dynamic = "force-dynamic";

interface PaymentRow {
  order_id: string; order_number: string; total_cents: number; email: string; status: string;
  checkout_expires_at: string | null; payment_intent_id: string | null;
}

export default async function PayPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order: orderId } = await searchParams;
  const user = await requireUser(`/checkout/pay?order=${orderId ?? ""}`);
  if (!orderId) redirect("/cart");

  const admin = createAdminClient();
  const { data: rows } = await admin.rpc("svc_order_for_payment", { p_order_id: orderId, p_user_id: user.id });
  const row = (rows as PaymentRow[] | null)?.[0];
  if (!row) redirect("/cart");
  if (row.status !== "pending_payment") redirect(`/account/orders/${row.order_number}`);

  const expired = row.checkout_expires_at && new Date(row.checkout_expires_at) < new Date();
  if (expired) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <PageTitle>Your hold expired</PageTitle>
        <p className="text-muted">We hold items for 15 minutes during payment. Your cart is still saved.</p>
        <Link href="/checkout" className="mt-6 inline-block underline underline-offset-4">Start checkout again</Link>
      </div>
    );
  }
  if (!stripeConfigured()) {
    return <div className="mx-auto max-w-md px-4 py-20"><Alert>Payments aren&apos;t configured yet.</Alert></div>;
  }

  // One PaymentIntent per order; reuse it if the customer reloads.
  let clientSecret: string | null = null;
  if (row.payment_intent_id) {
    const pi = await stripe().paymentIntents.retrieve(row.payment_intent_id);
    if (pi.amount === row.total_cents && pi.status !== "canceled") clientSecret = pi.client_secret;
  }
  if (!clientSecret) {
    const pi = await stripe().paymentIntents.create(
      {
        amount: row.total_cents,
        currency: "cad",
        automatic_payment_methods: { enabled: true },
        receipt_email: row.email,
        description: `Giftora order ${row.order_number}`,
        metadata: { order_id: row.order_id, order_number: row.order_number },
      },
      { idempotencyKey: `giftora-order-${row.order_id}-${row.total_cents}` },
    );
    await admin.rpc("svc_attach_payment_intent", {
      p_order_id: row.order_id, p_payment_intent_id: pi.id, p_amount_cents: row.total_cents,
    });
    clientSecret = pi.client_secret;
  }

  const supabase = await createClient();
  const { data: o } = await supabase.from("orders").select(ORDER_COLUMNS).eq("id", orderId).single();
  const order = o as unknown as OrderSummary;
  const tax = order.tax_breakdown;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-12">
      <PageTitle sub={`Order ${order.order_number}`}>Payment</PageTitle>
      <div className="grid gap-10 md:grid-cols-[1fr_280px]">
        <PaymentForm
          clientSecret={clientSecret!}
          publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
          returnUrl={`${site}/checkout/complete?order=${encodeURIComponent(order.order_number)}`}
          amountLabel={formatCad(order.total_cents)}
        />
        <Card className="h-fit text-sm">
          <dl className="space-y-2">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatCad(order.subtotal_cents)}</dd></div>
            <div className="flex justify-between"><dt>{order.shipping_method_name}</dt><dd>{order.shipping_cents ? formatCad(order.shipping_cents) : "Free"}</dd></div>
            {tax.hst ? <div className="flex justify-between"><dt>HST</dt><dd>{formatCad(tax.hst)}</dd></div> : null}
            {tax.gst ? <div className="flex justify-between"><dt>GST</dt><dd>{formatCad(tax.gst)}</dd></div> : null}
            {tax.pst ? <div className="flex justify-between"><dt>PST</dt><dd>{formatCad(tax.pst)}</dd></div> : null}
            <div className="flex justify-between border-t border-line pt-2 font-medium"><dt>Total</dt><dd>{formatCad(order.total_cents)}</dd></div>
          </dl>
          <p className="mt-4 text-xs text-muted">Card details go straight to Stripe. Giftora never sees or stores them.</p>
        </Card>
      </div>
    </div>
  );
}
