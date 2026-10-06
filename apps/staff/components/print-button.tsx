"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="h-10 rounded-lg bg-ink px-4 text-sm text-white print:hidden">
      Print
    </button>
  );
}
