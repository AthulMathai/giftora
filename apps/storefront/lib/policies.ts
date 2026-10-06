/**
 * Store policies shown on the FAQ, shipping & returns pages, llms.txt and structured data.
 * One place to change them. ⚠ The return window is a placeholder until the owner confirms it.
 */
export const POLICY = {
  returnDays: 30,
  standardShipping: "$12.99, free on orders over $75",
  expressShipping: "$24.99",
  shipsWithinBusinessDays: 3,
  deliveryBusinessDays: "3–7",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? null,
};
