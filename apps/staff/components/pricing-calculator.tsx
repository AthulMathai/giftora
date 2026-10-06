"use client";

import { useMemo, useState } from "react";
import { computePrice, formatCad, type Rounding } from "@giftora/pricing";

function pct(x: number) {
  return `${(x * 100).toFixed(1)}%`;
}

export function PricingCalculator() {
  const [cost, setCost] = useState("20.00");
  const [rate, setRate] = useState("10");
  const [minMargin, setMinMargin] = useState("5");
  const [minProfit, setMinProfit] = useState("3.00");
  const [rounding, setRounding] = useState<Rounding>("none");

  const results = useMemo(() => {
    const costCents = Math.round(Number(cost) * 100);
    const r = Number(rate) / 100;
    if (!Number.isFinite(costCents) || costCents < 0 || !Number.isFinite(r) || r < 0 || r >= 1) return null;
    const common = {
      costCents,
      rate: r,
      minMargin: Math.max(0, Math.min(0.99, Number(minMargin) / 100 || 0)),
      minProfitCents: Math.max(0, Math.round(Number(minProfit) * 100) || 0),
      rounding,
    };
    return {
      markup: computePrice({ ...common, ruleType: "markup" }),
      margin: computePrice({ ...common, ruleType: "margin" }),
    };
  }, [cost, rate, minMargin, minProfit, rounding]);

  const field = "mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2";

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="rounded-xl border border-line bg-panel p-5 space-y-4 text-sm">
        <label className="block">Supplier cost (CAD)
          <input className={field} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        </label>
        <label className="block">Rate (%)
          <input className={field} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label className="block">Minimum margin (%)
          <input className={field} inputMode="decimal" value={minMargin} onChange={(e) => setMinMargin(e.target.value)} />
        </label>
        <label className="block">Minimum profit per unit (CAD)
          <input className={field} inputMode="decimal" value={minProfit} onChange={(e) => setMinProfit(e.target.value)} />
        </label>
        <label className="block">Rounding
          <select className={field} value={rounding} onChange={(e) => setRounding(e.target.value as Rounding)}>
            <option value="none">None</option>
            <option value="charm_99">Up to .99</option>
          </select>
        </label>
      </div>

      {results ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {(["markup", "margin"] as const).map((type) => {
            const b = results[type];
            return (
              <div key={type} className="rounded-xl border border-line bg-panel p-5">
                <p className="text-sm font-medium capitalize">{rate}% {type}</p>
                <p className="mt-3 text-4xl font-semibold">{formatCad(b.priceCents)}</p>
                <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-muted">Profit</dt><dd className="text-right">{formatCad(b.profitCents)}</dd>
                  <dt className="text-muted">True margin</dt><dd className="text-right">{pct(b.trueMargin)}</dd>
                  <dt className="text-muted">True markup</dt><dd className="text-right">{pct(b.trueMarkup)}</dd>
                  <dt className="text-muted">Set by</dt>
                  <dd className={`text-right ${b.setBy === "floor" ? "text-warn" : ""}`}>{b.setBy === "floor" ? "Floor" : "Rule"}</dd>
                </dl>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-bad">Enter a cost of $0 or more and a rate between 0 and 99.99%.</p>
      )}
    </div>
  );
}
