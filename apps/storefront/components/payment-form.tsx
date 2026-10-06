"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useMemo, useState, type FormEvent } from "react";

const stripeCache = new Map<string, Promise<Stripe | null>>();
function getStripe(key: string) {
  let p = stripeCache.get(key);
  if (!p) { p = loadStripe(key); stripeCache.set(key, p); }
  return p;
}

export function PaymentForm(props: { clientSecret: string; publishableKey: string; returnUrl: string; amountLabel: string }) {
  const stripePromise = useMemo(() => getStripe(props.publishableKey), [props.publishableKey]);
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: props.clientSecret,
        appearance: {
          theme: "flat",
          variables: { colorPrimary: "#2b1b2e", colorBackground: "#fffdf9", borderRadius: "12px", fontFamily: "system-ui, sans-serif" },
        },
      }}
    >
      <Inner returnUrl={props.returnUrl} amountLabel={props.amountLabel} />
    </Elements>
  );
}

function Inner({ returnUrl, amountLabel }: { returnUrl: string; amountLabel: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setMessage(null);
    const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl } });
    // Only reached on an immediate error; success redirects to returnUrl.
    setMessage(error.type === "card_error" || error.type === "validation_error"
      ? error.message ?? "Your payment was declined."
      : "Something went wrong with the payment. Please try again.");
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <PaymentElement options={{ layout: "tabs" }} />
      {message && <p role="alert" className="rounded-xl border border-coral/40 bg-coral/5 px-4 py-3 text-sm text-coral-dark">{message}</p>}
      <button
        disabled={!stripe || busy}
        className="inline-flex h-12 w-full items-center justify-center rounded-full bg-ink px-7 text-cream transition hover:bg-coral disabled:opacity-50"
      >
        {busy ? "Processing…" : `Pay ${amountLabel}`}
      </button>
    </form>
  );
}
