import { describe as group, expect, it } from "vitest";
import { computePrice, describe, priceVariant, resolveRule, type PricingRule } from "./index";

// These cases are duplicated in supabase/tests/database/core_rules_test.sql.
// If you change one, change the other: the two engines must agree to the cent.
group("computePrice — same cases as the SQL tests", () => {
  it.each([
    [{ costCents: 2000, ruleType: "markup", rate: 0.1 }, 2200],
    [{ costCents: 2000, ruleType: "margin", rate: 0.1 }, 2222],
    [{ costCents: 2000, ruleType: "margin", rate: 0.1, minProfitCents: 500 }, 2500],
    [{ costCents: 2000, ruleType: "markup", rate: 0, minMargin: 0.2 }, 2500],
    [{ costCents: 2222, ruleType: "markup", rate: 0, rounding: "charm_99" }, 2299],
    [{ costCents: 2299, ruleType: "markup", rate: 0, rounding: "charm_99" }, 2299],
    [{ costCents: 3200, ruleType: "margin", rate: 0.1, minMargin: 0.05, minProfitCents: 300, rounding: "charm_99" }, 3599],
    [{ costCents: 2800, ruleType: "margin", rate: 0.25, minMargin: 0.05, minProfitCents: 300, rounding: "charm_99" }, 3799],
    [{ costCents: 1800, ruleType: "margin", rate: 0.1, minMargin: 0.05, minProfitCents: 300, rounding: "charm_99" }, 2199],
    [{ costCents: 3200, ruleType: "margin", rate: 0.2, minMargin: 0.05, minProfitCents: 300, rounding: "charm_99" }, 4099],
  ] as const)("%o -> %i cents", (input, expected) => {
    expect(computePrice(input).priceCents).toBe(expected);
  });
});

group("markup vs margin", () => {
  it("a 10% margin really is a 10% margin", () => {
    const b = computePrice({ costCents: 2000, ruleType: "margin", rate: 0.1 });
    expect(b.trueMargin).toBeCloseTo(0.1, 3);
  });
  it("a 10% markup is only a 9.1% margin", () => {
    const b = computePrice({ costCents: 2000, ruleType: "markup", rate: 0.1 });
    expect(b.trueMargin).toBeCloseTo(0.0909, 3);
    expect(b.trueMarkup).toBeCloseTo(0.1, 3);
  });
  it("reports when a floor set the price", () => {
    expect(computePrice({ costCents: 1800, ruleType: "margin", rate: 0.1, minProfitCents: 300 }).setBy).toBe("floor");
    expect(computePrice({ costCents: 3200, ruleType: "margin", rate: 0.1, minProfitCents: 300 }).setBy).toBe("rule");
  });
  it("describes a rule in plain words", () => {
    expect(describe({ costCents: 2000, ruleType: "margin", rate: 0.1 })).toBe(
      "10.0% margin: $20.00 → $22.22 (10.0% margin, 11.1% markup)",
    );
  });
});

group("input validation", () => {
  it("rejects a 100% margin", () => {
    expect(() => computePrice({ costCents: 2000, ruleType: "margin", rate: 1 })).toThrow(/below 100%/);
  });
  it("rejects fractional or negative cents", () => {
    expect(() => computePrice({ costCents: 20.5, ruleType: "markup", rate: 0.1 })).toThrow(RangeError);
    expect(() => computePrice({ costCents: -1, ruleType: "markup", rate: 0.1 })).toThrow(RangeError);
  });
  it("has no floating-point drift on awkward rates", () => {
    // 0.07 * 100 is 7.000000000000001 in floating point; integer math must not care.
    expect(computePrice({ costCents: 100, ruleType: "markup", rate: 0.07 }).priceCents).toBe(107);
    expect(computePrice({ costCents: 1999, ruleType: "margin", rate: 0.3333 }).priceCents).toBe(2998);
  });
});

group("rule precedence", () => {
  const rules: PricingRule[] = [
    { id: "g", scope: "global", targetId: null, ruleType: "margin", rate: 0.1, minMargin: 0.05, minProfitCents: 300, rounding: "charm_99", active: true },
    { id: "parent", scope: "category", targetId: "home", ruleType: "margin", rate: 0.15, active: true },
    { id: "child", scope: "category", targetId: "kitchen", ruleType: "margin", rate: 0.2, active: true },
    { id: "p", scope: "product", targetId: "mug", ruleType: "markup", rate: 0.5, active: true },
    { id: "v", scope: "variant", targetId: "mug-red", ruleType: "markup", rate: 0.6, active: true },
    { id: "off", scope: "variant", targetId: "mug-blue", ruleType: "markup", rate: 9, active: false },
  ];
  const ctx = (variantId: string, productId: string, chain: string[]) => ({ variantId, productId, categoryChain: chain });

  it("variant beats product", () => expect(resolveRule(rules, ctx("mug-red", "mug", ["kitchen", "home"]))?.rule.id).toBe("v"));
  it("product beats category", () => expect(resolveRule(rules, ctx("mug-white", "mug", ["kitchen", "home"]))?.rule.id).toBe("p"));
  it("inactive rules are ignored", () => expect(resolveRule(rules, ctx("mug-blue", "mug", ["kitchen", "home"]))?.rule.id).toBe("p"));
  it("nearest category wins", () => expect(resolveRule(rules, ctx("x", "plate", ["kitchen", "home"]))?.rule.id).toBe("child"));
  it("falls back to parent category", () => expect(resolveRule(rules, ctx("x", "rug", ["home"]))?.rule.id).toBe("parent"));
  it("falls back to global", () => expect(resolveRule(rules, ctx("x", "hat", ["apparel"]))?.rule.id).toBe("g"));
  it("narrow rules inherit global floors and rounding", () => {
    const eff = resolveRule(rules, ctx("x", "plate", ["kitchen"]))!;
    expect([eff.minMargin, eff.minProfitCents, eff.rounding]).toEqual([0.05, 300, "charm_99"]);
  });
  it("prices a variant end to end", () => {
    // kitchen 20% margin on $32.00 = $40.00 -> charm $40.99
    expect(priceVariant(3200, rules, ctx("x", "plate", ["kitchen", "home"]))?.priceCents).toBe(4099);
  });
  it("returns null with no rules", () => expect(priceVariant(3200, [], ctx("x", "y", []))).toBeNull());
});
