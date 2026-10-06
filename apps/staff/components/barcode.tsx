import { code128B } from "@/lib/code128";

/** Code 128 barcode as crisp SVG (prints sharply on thermal printers). */
export function Barcode({ value, height = 60, className = "" }: { value: string; height?: number; className?: string }) {
  const widths = code128B(value);
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  const bars: { x: number; w: number }[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return (
    <svg viewBox={`0 0 ${total} ${height}`} preserveAspectRatio="none" className={className} role="img" aria-label={`Barcode ${value}`}
         shapeRendering="crispEdges">
      <rect width={total} height={height} fill="#fff" />
      {bars.map((b, i) => <rect key={i} x={b.x} width={b.w} height={height} fill="#000" />)}
    </svg>
  );
}
