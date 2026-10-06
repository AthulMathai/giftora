/** Shared (browser + server) shapes and labels for staff-created orders. */

export interface VariantHit {
  variant_id: string; sku: string; product: string; variant: string;
  price_cents: number | null; status: string; available: number;
}

export interface QuoteLine {
  variant_id: string; sku: string; product: string; variant: string; quantity: number;
  unit_price_cents: number; line_total_cents: number; status: string; available: number;
}

export interface Quote {
  lines: QuoteLine[]; subtotal_cents: number; discount_cents: number; shipping_cents: number;
  shipping_method_name: string; tax_cents: number; tax_breakdown: Record<string, string | number>; total_cents: number;
}

export type OrderSource = "phone" | "in_person" | "social" | "email" | "marketplace" | "other";
export type ShippingChoice = "standard" | "express" | "pickup";
export type ManualMethod = "cash" | "etransfer" | "card_terminal" | "cheque" | "other";

export interface QuoteInput {
  items: { variant_id: string; quantity: number }[];
  shipping_method: ShippingChoice;
  province: string;
  discount_cents: number;
}

export interface StaffOrderInput {
  source: OrderSource;
  email?: string; phone?: string; note?: string;
  shipping_method: ShippingChoice;
  shipping_address: { full_name: string; line1?: string; line2?: string; city?: string; province: string; postal_code?: string; phone?: string };
  items: { variant_id: string; quantity: number }[];
  discount_cents?: number;
  ship_by?: string;
  payment: { status: "paid" | "unpaid"; method?: ManualMethod; reference?: string; fee_cents?: number };
}

export const SOURCES: [string, string][] = [
  ["phone", "Phone"], ["in_person", "In person"], ["social", "Instagram / Facebook"],
  ["email", "Email"], ["marketplace", "Marketplace"], ["other", "Other"],
];
export const SOURCE_BADGE: Record<string, string> = {
  web: "Web", phone: "Phone", in_person: "In person", social: "Social", email: "Email", marketplace: "Marketplace", other: "Other",
};

export const PAYMENT_METHODS: [ManualMethod, string][] = [
  ["etransfer", "e-Transfer"], ["cash", "Cash"], ["card_terminal", "Card terminal"], ["cheque", "Cheque"], ["other", "Other"],
];
export const PAYMENT_LABEL: Record<string, string> = {
  stripe: "Card (online)", etransfer: "e-Transfer", cash: "Cash", card_terminal: "Card terminal", cheque: "Cheque", other: "Other",
};

export const PROVINCES: [string, string][] = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"],
  ["NL", "Newfoundland and Labrador"], ["NS", "Nova Scotia"], ["NT", "Northwest Territories"], ["NU", "Nunavut"],
  ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"],
];

export const money = (c: number | null | undefined) =>
  c == null ? "—" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(c / 100);

/** "$12.50", "12.5", "1,299" -> cents. Empty -> 0. Invalid -> null. */
export function dollarsToCents(input: string): number | null {
  const s = input.replace(/[$,\s]/g, "");
  if (s === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
