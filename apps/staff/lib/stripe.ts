import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

/** Stripe client for refunds. Only used after requireStaff("refunds.create"). */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured for the staff app");
  client ??= new Stripe(key, { appInfo: { name: "Giftora Staff" }, maxNetworkRetries: 2 });
  return client;
}
