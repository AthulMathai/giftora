"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createStaffOrder, quoteStaffOrder, searchVariants } from "@/app/orders/actions";
import {
  dollarsToCents, money, PAYMENT_METHODS, PROVINCES, SOURCES,
  type ManualMethod, type OrderSource, type Quote, type ShippingChoice, type StaffOrderInput, type VariantHit,
} from "@/lib/staff-orders";
import { Button, Input, Notice, Panel, Select, Textarea } from "./form";

interface Line extends VariantHit { quantity: number }

const SELLABLE = ["active", "seasonal"];

export function NewOrderForm() {
  // Items
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VariantHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const searchSeq = useRef(0);
  const searchBox = useRef<HTMLInputElement>(null);

  // Customer and delivery
  const [source, setSource] = useState<OrderSource>("phone");
  const [shipping, setShipping] = useState<ShippingChoice>("standard");
  const [addr, setAddr] = useState({ full_name: "", line1: "", line2: "", city: "", province: "ON", postal_code: "" });
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [discount, setDiscount] = useState("");

  // Payment
  const [paid, setPaid] = useState<"paid" | "unpaid">("paid");
  const [method, setMethod] = useState<ManualMethod>("etransfer");
  const [reference, setReference] = useState("");
  const [fee, setFee] = useState("");

  // Totals and submit
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const quoteSeq = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const discountCents = dollarsToCents(discount);
  const feeCents = dollarsToCents(fee);

  // Debounced search as staff type.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); setSearchNote(null); return; }
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchVariants(q);
        if (seq !== searchSeq.current) return;
        setHits(r);
        setSearchNote(r.length === 0 ? "Nothing matches. Try part of the name, the SKU or scan the barcode." : null);
      } catch (e) {
        if (seq === searchSeq.current) setSearchNote((e as Error).message);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // Live totals whenever anything that changes the price changes.
  const itemsKey = lines.map((l) => `${l.variant_id}:${l.quantity}`).join(",");
  useEffect(() => {
    if (lines.length === 0) { setQuote(null); setQuoteError(null); return; }
    if (discountCents === null) { setQuoteError("Enter the discount like 5 or 5.50."); return; }
    const seq = ++quoteSeq.current;
    const t = setTimeout(async () => {
      setQuoting(true);
      try {
        const r = await quoteStaffOrder({
          items: lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity })),
          shipping_method: shipping, province: addr.province, discount_cents: discountCents,
        });
        if (seq !== quoteSeq.current) return;
        setQuote(r.quote ?? null);
        setQuoteError(r.error ?? null);
      } catch (e) {
        if (seq === quoteSeq.current) setQuoteError((e as Error).message);
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    }, 300);
    return () => clearTimeout(t);
    // itemsKey stands in for `lines`, so the quote only refreshes when items or quantities change.
  }, [itemsKey, shipping, addr.province, discountCents]);

  function add(v: VariantHit) {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.variant_id === v.variant_id);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l));
      return [...ls, { ...v, quantity: 1 }];
    });
    setQuery("");
    setHits([]);
    setSearchNote(null);
    searchBox.current?.focus();
  }

  const setQty = (id: string, q: number) =>
    setLines((ls) => ls.map((l) => (l.variant_id === id ? { ...l, quantity: Math.max(1, Math.min(999, Math.floor(q) || 1)) } : l)));
  const remove = (id: string) => setLines((ls) => ls.filter((l) => l.variant_id !== id));

  /** Enter in the search box (or a USB barcode scanner) adds the single exact match straight away. */
  async function onSearchEnter() {
    const q = query.trim();
    if (q.length < 2) return;
    searchSeq.current++;
    setSearching(true);
    try {
      const r = await searchVariants(q);
      const exact = r.filter((h) => h.sku.toLowerCase() === q.toLowerCase());
      const pick = exact.length === 1 ? exact[0] : r.length === 1 ? r[0] : undefined;
      if (pick) add(pick);
      else {
        setHits(r);
        setSearchNote(r.length === 0 ? `Nothing matches “${q}”.` : "More than one match — pick one below.");
      }
    } catch (e) {
      setSearchNote((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  function submit() {
    setError(null);
    if (lines.length === 0) return setError("Add at least one item.");
    if (!addr.full_name.trim()) return setError("Enter the customer's name.");
    if (shipping !== "pickup" && (!addr.line1.trim() || !addr.city.trim() || !addr.postal_code.trim())) {
      return setError("Enter the full shipping address, or choose Local pickup.");
    }
    if (discountCents === null) return setError("Enter the discount like 5 or 5.50.");
    if (paid === "paid" && feeCents === null) return setError("Enter the card fee like 1.25, or leave it empty.");

    const input: StaffOrderInput = {
      source,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      note: note.trim() || undefined,
      shipping_method: shipping,
      shipping_address: shipping === "pickup"
        ? { full_name: addr.full_name, province: addr.province, phone: phone.trim() || undefined }
        : { ...addr, phone: phone.trim() || undefined },
      items: lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity })),
      discount_cents: discountCents || undefined,
      payment: paid === "paid"
        ? { status: "paid", method, reference: reference.trim() || undefined, fee_cents: feeCents || undefined }
        : { status: "unpaid" },
    };
    startTransition(async () => {
      const r = await createStaffOrder(input);
      if (r?.error) setError(r.error);
    });
  }

  const tooMany = lines.some((l) => l.quantity > l.available);
  const notForSale = lines.some((l) => !SELLABLE.includes(l.status));
  const field = (k: keyof typeof addr) => ({
    value: addr[k],
    onChange: (e: { target: { value: string } }) => setAddr((a) => ({ ...a, [k]: e.target.value })),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <Panel title="1. Items">
          <div className="relative">
            <Input ref={searchBox} label="Find a product" value={query} autoFocus autoComplete="off"
                   onChange={(e) => setQuery(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onSearchEnter(); } }}
                   placeholder="Type a name or SKU, or scan a barcode"
                   hint={searching ? "Searching…" : "Press Enter to add an exact SKU or barcode match straight away."} />
            {searchNote && <p className="mt-2 text-sm text-muted">{searchNote}</p>}
            {hits.length > 0 && (
              <ul className="mt-2 max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-white">
                {hits.map((h) => {
                  const sellable = SELLABLE.includes(h.status) && h.price_cents != null;
                  return (
                    <li key={h.variant_id}>
                      <button type="button" onClick={() => add(h)} disabled={!sellable}
                              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60">
                        <span className="w-28 shrink-0 font-mono text-xs">{h.sku}</span>
                        <span className="flex-1">{h.product} <span className="text-muted">— {h.variant}</span></span>
                        <span className={`text-xs ${h.available > 0 ? "text-muted" : "text-bad"}`}>
                          {sellable ? `${h.available} available` : "not for sale"}
                        </span>
                        <span className="w-20 text-right">{money(h.price_cents)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {lines.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No items yet.</p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="pb-1 font-normal">Item</th><th className="pb-1 text-center font-normal">Quantity</th><th className="pb-1 text-right font-normal">Price</th><th className="sr-only">Remove</th></tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.variant_id} className="border-t border-line align-top">
                    <td className="py-2">
                      <span className="font-mono text-xs">{l.sku}</span><br />
                      {l.product} <span className="text-muted">— {l.variant}</span>
                      {l.quantity > l.available && (
                        <span className="mt-1 block text-xs text-bad">Only {l.available} available — the order can&apos;t be placed with this many.</span>
                      )}
                      {!SELLABLE.includes(l.status) && <span className="mt-1 block text-xs text-bad">Not for sale right now.</span>}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center justify-center gap-1">
                        <button type="button" aria-label={`One fewer ${l.sku}`} onClick={() => setQty(l.variant_id, l.quantity - 1)}
                                className="size-8 rounded-lg border border-line bg-white hover:border-ink">−</button>
                        <input aria-label={`Quantity of ${l.sku}`} inputMode="numeric" value={l.quantity}
                               onChange={(e) => setQty(l.variant_id, Number(e.target.value))}
                               className="h-8 w-12 rounded-lg border border-line bg-white text-center" />
                        <button type="button" aria-label={`One more ${l.sku}`} onClick={() => setQty(l.variant_id, l.quantity + 1)}
                                className="size-8 rounded-lg border border-line bg-white hover:border-ink">+</button>
                      </div>
                      <p className="mt-1 text-center text-xs text-muted">{l.available} available</p>
                    </td>
                    <td className="py-2 text-right">{money((l.price_cents ?? 0) * l.quantity)}</td>
                    <td className="py-2 pl-2 text-right">
                      <button type="button" onClick={() => remove(l.variant_id)} className="text-xs text-bad underline">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="2. Customer and delivery">
          <div className="grid gap-4 md:grid-cols-2">
            <Select label="Where did this order come from?" value={source} onChange={(e) => setSource(e.target.value as OrderSource)}>
              {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <Select label="Delivery" value={shipping} onChange={(e) => setShipping(e.target.value as ShippingChoice)}>
              <option value="standard">Standard shipping</option>
              <option value="express">Express shipping</option>
              <option value="pickup">Local pickup (no shipping charge)</option>
            </Select>
            <Input label="Customer name" required {...field("full_name")} autoComplete="off" />
            <Input label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off"
                   hint="If they have a Giftora account, the order shows up there and they get emails." />
            <Input label="Phone (optional)" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
            {shipping !== "pickup" && (
              <>
                <Input label="Address" {...field("line1")} required autoComplete="off" />
                <Input label="Unit / suite (optional)" {...field("line2")} autoComplete="off" />
                <Input label="City" {...field("city")} required autoComplete="off" />
                <Input label="Postal code" {...field("postal_code")} required autoComplete="off" placeholder="M5V 2T6" />
              </>
            )}
            <Select label="Province" {...field("province")}>
              {PROVINCES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </Select>
            {shipping === "pickup" && <p className="self-end pb-2 text-xs text-muted">Sales tax uses the province. No address needed for pickup.</p>}
            <Input label="Discount in dollars (optional)" value={discount} onChange={(e) => setDiscount(e.target.value)}
                   inputMode="decimal" placeholder="0.00" hint="Comes off the items before tax." />
            <Textarea label="Note for the team (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="md:col-span-2"
                      placeholder="e.g. Gift wrap please; customer messaged on Instagram @name" />
          </div>
        </Panel>

        <Panel title="3. Payment">
          <fieldset className="space-y-3">
            <legend className="sr-only">Has the customer paid?</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="paid" checked={paid === "paid"} onChange={() => setPaid("paid")} className="mt-0.5 size-4 accent-ink" />
              <span><strong>Paid now</strong></span>
            </label>
            {paid === "paid" && (
              <div className="ml-6 grid gap-3 md:grid-cols-3">
                <Select label="How they paid" value={method} onChange={(e) => setMethod(e.target.value as ManualMethod)}>
                  {PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
                <Input label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)}
                       placeholder="e-Transfer ref, receipt #" />
                {method === "card_terminal" && (
                  <Input label="Card terminal fee (optional)" value={fee} onChange={(e) => setFee(e.target.value)}
                         inputMode="decimal" placeholder="0.00" hint="So profit reports stay accurate." />
                )}
              </div>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="paid" checked={paid === "unpaid"} onChange={() => setPaid("unpaid")} className="mt-0.5 size-4 accent-ink" />
              <span>
                <strong>Not paid yet</strong> (e.g. waiting on an e-transfer)
                <span className="block text-muted">The stock is held until you mark it paid or cancel it on the Orders page.</span>
              </span>
            </label>
          </fieldset>
        </Panel>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <Panel title="Totals">
          {lines.length === 0 ? (
            <p className="text-sm text-muted">Add items to see the total.</p>
          ) : (
            <dl className={`space-y-1.5 text-sm ${quoting ? "opacity-60" : ""}`} aria-live="polite">
              {quote ? (
                <>
                  <Row label="Items" value={money(quote.subtotal_cents)} />
                  {quote.discount_cents > 0 && <Row label="Discount" value={`−${money(quote.discount_cents)}`} />}
                  <Row label={quote.shipping_method_name} value={quote.shipping_cents ? money(quote.shipping_cents) : "Free"} />
                  <Row label={`Tax${taxLabel(quote.tax_breakdown)}`} value={money(quote.tax_cents)} />
                  <div className="mt-2 flex justify-between border-t border-line pt-2 text-base font-semibold">
                    <dt>Total</dt><dd>{money(quote.total_cents)}</dd>
                  </div>
                </>
              ) : (
                <p className="text-muted">{quoting ? "Calculating…" : ""}</p>
              )}
            </dl>
          )}
          {quoteError && <p className="mt-3 text-sm text-bad">{quoteError}</p>}
          <div className="mt-5 space-y-3">
            {error && <Notice tone="bad">{error}</Notice>}
            {(tooMany || notForSale) && <Notice tone="warn">Fix the items marked in red before creating the order.</Notice>}
            <Button type="submit" disabled={pending || lines.length === 0} className="h-11 w-full">
              {pending ? "Creating order…" : paid === "paid" ? "Create paid order" : "Create order (not paid yet)"}
            </Button>
            <p className="text-xs text-muted">Stock is reserved as soon as the order is created. Paid orders go straight into the queue for the next batch.</p>
          </div>
        </Panel>
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-muted">{label}</dt><dd>{value}</dd></div>;
}

function taxLabel(b: Record<string, string | number>): string {
  const parts = (["hst", "gst", "pst"] as const).filter((k) => b[k]).map((k) => k.toUpperCase());
  return parts.length ? ` (${parts.join(" + ")}${b.province ? `, ${b.province}` : ""})` : "";
}
