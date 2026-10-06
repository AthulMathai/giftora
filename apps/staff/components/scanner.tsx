"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ScanResult } from "@/app/fulfillment/actions";

// Minimal typing for the browser's built-in BarcodeDetector (Chrome/Android/Edge).
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

/** Prints a bin's 4×6 label in a hidden frame the moment the bin is complete. */
function printLabel(orderId: string) {
  const frame = document.createElement("iframe");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  frame.src = `/labels/${orderId}?print=1`;
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 120_000);
}

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 880 : 220;
    osc.type = ok ? "sine" : "square";
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.35));
    if (!ok && "vibrate" in navigator) navigator.vibrate(200);
  } catch { /* sound is optional */ }
}

const TONE: Record<string, string> = {
  ok: "border-ok bg-ok/10",
  wrong_variant: "border-warn bg-warn/15",
  not_required: "border-warn bg-warn/15",
  not_in_order: "border-bad bg-bad/10",
  already_packed: "border-warn bg-warn/15",
  unknown_code: "border-warn bg-warn/15",
  not_ready: "border-warn bg-warn/15",
  open_pack: "border-accent bg-accent/10",
  error: "border-bad bg-bad/10",
};

export function Scanner({ mode, scan }: {
  mode: "sort" | "pack";
  scan: (code: string, key: string) => Promise<ScanResult>;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [camera, setCamera] = useState<"off" | "on" | "unsupported">("off");
  const busyRef = useRef(false);

  const submit = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const key = crypto.randomUUID();
    let res: ScanResult;
    try { res = await scan(value, key); } catch (e) { res = { result: "error", message: (e as Error).message }; }
    setLast(res);
    beep(res.result === "ok");
    if (mode === "sort" && res.result === "ok" && res.order_complete && res.order_id) printLabel(res.order_id);
    setCode("");
    busyRef.current = false;
    setBusy(false);
    input.current?.focus();
    router.refresh();
  }, [scan, router, mode]);

  // Keep the scan box focused so a hardware scanner always types into it.
  useEffect(() => {
    const t = setInterval(() => {
      const active = document.activeElement;
      if (!active || active === document.body) input.current?.focus();
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Camera scanning with the browser's BarcodeDetector, where available.
  useEffect(() => {
    if (camera !== "on") return;
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Ctor) { setCamera("unsupported"); return; }
    let stream: MediaStream | null = null;
    let stopped = false;
    let pausedUntil = 0;
    const detector = new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stopped) {
          if (Date.now() > pausedUntil && video.current && video.current.readyState >= 2) {
            const found = await detector.detect(video.current).catch(() => []);
            if (found[0]?.rawValue) { pausedUntil = Date.now() + 1500; void submit(found[0].rawValue); }
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch { setCamera("unsupported"); }
    })();
    return () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [camera, submit]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(code);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          ref={input} value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="off" spellCheck={false}
          placeholder={mode === "sort" ? "Scan an item (or type its SKU) and press Enter" : "Scan each item going into the box"}
          aria-label="Barcode or SKU"
          className="h-14 flex-1 rounded-xl border-2 border-ink bg-white px-4 font-mono text-xl outline-none"
        />
        <button disabled={busy || !code.trim()} className="h-14 rounded-xl bg-ink px-6 text-white disabled:opacity-40">Enter</button>
      </form>

      <div className="flex items-center gap-3 text-sm">
        {camera === "on" ? (
          <button onClick={() => setCamera("off")} className="underline">Stop camera</button>
        ) : camera === "unsupported" ? (
          <span className="text-muted">Camera scanning isn&apos;t supported in this browser. Use a USB/Bluetooth scanner or type the SKU.</span>
        ) : (
          <button onClick={() => setCamera("on")} className="underline">Use camera</button>
        )}
      </div>
      {camera === "on" && <video ref={video} muted playsInline className="max-h-64 w-full rounded-xl bg-black object-cover" />}

      {last && (
        <div role="status" aria-live="assertive" className={`rounded-2xl border-4 p-6 ${TONE[last.result] ?? "border-line"}`}>
          {last.result === "ok" && mode === "sort" ? (
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div>
                <p className="text-sm uppercase tracking-wide text-muted">Put it in</p>
                <p className="text-7xl font-bold leading-none">{last.bin}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold">{last.order_number}</p>
                <p>{last.product} — {last.variant}</p>
                <p className="font-mono text-sm text-muted">{last.sku}</p>
                {(last.pack_qty ?? 1) > 1 && (
                  <p className="mt-1 inline-block rounded-full bg-ink px-3 py-0.5 text-sm text-white">
                    Whole {last.pack_kind ?? "pack"} — {last.pack_qty} units, keep it sealed
                  </p>
                )}
                <p className="mt-2 text-3xl font-bold">{last.sorted} of {last.required}</p>
                {last.order_complete && (
                  <p className="mt-1 font-semibold text-ok">
                    Bin complete — label printing.{" "}
                    {last.order_id && <a href={`/labels/${last.order_id}?print=1`} target="_blank" rel="noreferrer" className="underline">Reprint</a>}
                  </p>
                )}
              </div>
            </div>
          ) : last.result === "ok" ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-lg font-semibold">{last.product} — {last.variant}</p>
                <p className="font-mono text-sm text-muted">{last.sku}</p>
              </div>
              <p className="text-4xl font-bold">{last.packed} of {last.required}{(last.pack_qty ?? 1) > 1 ? ` (+${last.pack_qty})` : ""}</p>
              {last.order_complete && <p className="w-full font-semibold text-ok">Everything verified. Order is packed — enter tracking below.</p>}
            </div>
          ) : (
            <div>
              <p className="text-2xl font-bold">{last.message}</p>
              {last.product && <p className="mt-1 text-sm text-muted">Scanned: {last.product} — {last.variant} ({last.sku})</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
