/**
 * Giftora pricing engine (TypeScript mirror of internal.compute_price in Postgres).
 *
 * The database is the source of truth for stored prices. This package exists so the staff app
 * can preview a rule change ("what will this do to prices?") before saving it, and so the two
 * implementations are tested against the same cases.
 *
 * All math is exact integer math on cents and basis-point-style rates (4 decimals, matching
 * the numeric(7,4) column), so there is no floating-point drift between JS and Postgres.
 *
 *   markup: price = cost * (1 + rate)     10% on $20.00 -> $22.00  (true margin 9.1%)
 *   margin: price = cost / (1 - rate)     10% on $20.00 -> $22.22  (true margin 10.0%)
 */

export type RuleType = "markup" | "margin";
export type Rounding = "none" | "charm_99";
export type Scope = "global" | "category" | "product" | "variant";

export interface PricingInput {
  costCents: number;
  ruleType: RuleType;
  /** Decimal rate, e.g. 0.1 for 10%. Stored with 4 decimal places. */
  rate: number;
  /** Floor: never sell below this true margin (decimal). */
  minMargin?: number;
  /** Floor: never earn less than this many cents per unit. */
  minProfitCents?: number;
  rounding?: Rounding;
}

export interface PriceBreakdown {
  baseCents: number;
  floorCents: number;
  priceCents: number;
  profitCents: number;
  /** profit / price, e.g. 0.1 = 10% */
  trueMargin: number;
  /** profit / cost, e.g. 0.111 = 11.1% */
  trueMarkup: number;
  /** Which constraint set the final price. */
  setBy: "rule" | "floor";
}

const SCALE = 10_000n; // 4-decimal rates

function toRate4(rate: number): bigint {
  if (!Number.isFinite(rate) || rate < 0) throw new RangeError(`rate must be >= 0, got ${rate}`);
  return BigInt(Math.round(rate * 10_000));
}

function toCents(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer number of cents, got ${value}`);
  }
  return BigInt(value);
}

/** Round a positive fraction num/den to the nearest integer, halves away from zero (Postgres round). */
function roundHalfUp(num: bigint, den: bigint): bigint {
  return (2n * num + den) / (2n * den);
}

function ceilDiv(num: bigint, den: bigint): bigint {
  return (num + den - 1n) / den;
}

export function computePrice(input: PricingInput): PriceBreakdown {
  const cost = toCents(input.costCents, "costCents");
  const r = toRate4(input.rate);
  const minMargin = toRate4(input.minMargin ?? 0);
  const minProfit = toCents(input.minProfitCents ?? 0, "minProfitCents");

  let base: bigint;
  if (input.ruleType === "markup") {
    base = roundHalfUp(cost * (SCALE + r), SCALE);
  } else {
    if (r >= SCALE) throw new RangeError("margin rate must be below 100%");
    base = roundHalfUp(cost * SCALE, SCALE - r);
  }

  if (minMargin >= SCALE) throw new RangeError("minMargin must be below 100%");
  const marginFloor = ceilDiv(cost * SCALE, SCALE - minMargin);
  const floor = marginFloor > cost + minProfit ? marginFloor : cost + minProfit;

  let price = base > floor ? base : floor;
  if ((input.rounding ?? "none") === "charm_99") {
    price = ceilDiv(price + 1n, 100n) * 100n - 1n;
  }

  const priceN = Number(price);
  const costN = Number(cost);
  const profit = priceN - costN;
  return {
    baseCents: Number(base),
    floorCents: Number(floor),
    priceCents: priceN,
    profitCents: profit,
    trueMargin: priceN === 0 ? 0 : profit / priceN,
    trueMarkup: costN === 0 ? 0 : profit / costN,
    setBy: floor > base ? "floor" : "rule",
  };
}

export interface PricingRule {
  id: string;
  scope: Scope;
  /** Target id for category/product/variant scope; null for global. */
  targetId: string | null;
  ruleType: RuleType;
  rate: number;
  minMargin?: number | null;
  minProfitCents?: number | null;
  rounding?: Rounding | null;
  active: boolean;
}

export interface VariantContext {
  variantId: string;
  productId: string;
  /** Category ids from the variant's own category up to the root, nearest first. */
  categoryChain: string[];
}

export interface EffectiveRule {
  rule: PricingRule;
  minMargin: number;
  minProfitCents: number;
  rounding: Rounding;
}

/**
 * Most specific active rule wins: variant > product > nearest category > global.
 * Floors and rounding left unset on the winning rule inherit from the global rule.
 * Mirrors internal.effective_pricing().
 */
export function resolveRule(rules: PricingRule[], ctx: VariantContext): EffectiveRule | null {
  const active = rules.filter((r) => r.active);
  const global = active.find((r) => r.scope === "global") ?? null;
  const chosen =
    active.find((r) => r.scope === "variant" && r.targetId === ctx.variantId) ??
    active.find((r) => r.scope === "product" && r.targetId === ctx.productId) ??
    ctx.categoryChain
      .map((c) => active.find((r) => r.scope === "category" && r.targetId === c))
      .find((r): r is PricingRule => r !== undefined) ??
    global;
  if (!chosen) return null;
  return {
    rule: chosen,
    minMargin: chosen.minMargin ?? global?.minMargin ?? 0,
    minProfitCents: chosen.minProfitCents ?? global?.minProfitCents ?? 0,
    rounding: chosen.rounding ?? global?.rounding ?? "none",
  };
}

/** Price a variant from its cost and the full rule set. */
export function priceVariant(costCents: number, rules: PricingRule[], ctx: VariantContext): PriceBreakdown | null {
  const eff = resolveRule(rules, ctx);
  if (!eff) return null;
  return computePrice({
    costCents,
    ruleType: eff.rule.ruleType,
    rate: eff.rule.rate,
    minMargin: eff.minMargin,
    minProfitCents: eff.minProfitCents,
    rounding: eff.rounding,
  });
}

/** Human description used next to the rule editor, e.g. "10% margin: $20.00 → $22.22 (10.0% margin, 11.1% markup)". */
export function describe(input: PricingInput): string {
  const b = computePrice(input);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  return `${pct(input.rate)} ${input.ruleType}: ${formatCad(input.costCents)} → ${formatCad(b.priceCents)} ` +
    `(${pct(b.trueMargin)} margin, ${pct(b.trueMarkup)} markup${b.setBy === "floor" ? ", raised by floor" : ""})`;
}

export function formatCad(cents: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}
