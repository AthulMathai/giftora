"use client";

import { useEffect, useRef } from "react";

/**
 * Opens the print dialog once the label has rendered, after recording the print.
 * Tip: in Chrome, starting with --kiosk-printing sends labels straight to the default
 * (thermal) printer with no dialog at all.
 */
export function AutoPrint({ record }: { record: () => Promise<unknown> }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    (async () => {
      try { await record(); } catch { /* printing still matters more than the counter */ }
      window.print();
    })();
  }, [record]);
  return null;
}
