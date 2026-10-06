const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

export function formatCad(cents: number): string {
  return cad.format(cents / 100);
}

export function priceRange(prices: number[]): string {
  if (prices.length === 0) return "";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatCad(min) : `${formatCad(min)} – ${formatCad(max)}`;
}
