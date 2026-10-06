import { PricingCalculator } from "@/components/pricing-calculator";

export const metadata = { title: "Pricing calculator" };

export default function PricingToolPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Pricing calculator</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        The same engine the database uses. A <strong>markup</strong> is a percentage of cost; a <strong>margin</strong> is
        a percentage of the selling price. The same &ldquo;10%&rdquo; gives two different prices.
      </p>
      <PricingCalculator />
    </div>
  );
}
