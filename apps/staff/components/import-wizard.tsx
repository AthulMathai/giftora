"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { applyImport, previewImport, suggestWithAi, type AiSuggestion, type ApplyResult, type PlanRow, type Preview } from "@/app/products/import/actions";
import { FIELDS, guessMapping, normalize, type FieldKey, type ImportRow, type Mapping } from "@/lib/import";
import { Button, Notice, Panel } from "./form";

type Sheet = { name: string; rows: unknown[][] };
const cad = (c: unknown) => (typeof c === "number" ? `$${(c / 100).toFixed(2)}` : c === null || c === undefined ? "—" : String(c));
const MAP_KEY = "giftora.import.mapping";

export function ImportWizard({ aiName }: { aiName: string | null }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState<Mapping>({});
  const [optionNames, setOptionNames] = useState<[string, string]>(["Size", "Colour"]);
  const [updateContent, setUpdateContent] = useState(false);
  const [publish, setPublish] = useState(false);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filter, setFilter] = useState<"all" | PlanRow["action"]>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [aiDone, setAiDone] = useState(0);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const sheet = sheets[sheetIdx];
  const headers = useMemo(() => (sheet?.rows[headerRow - 1] ?? []).map((h) => String(h ?? "").trim()).filter(Boolean), [sheet, headerRow]);
  const objects = useMemo(() => {
    if (!sheet) return [];
    const hdr = (sheet.rows[headerRow - 1] ?? []).map((h) => String(h ?? "").trim());
    return sheet.rows.slice(headerRow).map((r) => Object.fromEntries(hdr.map((h, i) => [h, r[i]]).filter(([h]) => h)));
  }, [sheet, headerRow]);
  const sample = objects[0] ?? {};

  async function readFile(file: File) {
    setError(null); setPreview(null); setRows(null); setResult(null); setAiDone(0);
    setBusy("Reading the sheet…");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const all: Sheet[] = wb.SheetNames.map((n) => ({
        name: n,
        rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n]!, { header: 1, raw: true, defval: "", blankrows: false }),
      })).filter((s) => s.rows.length > 1);
      if (all.length === 0) throw new Error("That file has no rows.");
      setSheets(all); setSheetIdx(0); setFileName(file.name);
      const first = all[0]!;
      // Header = first row with at least two text cells.
      const h = first.rows.findIndex((r) => r.filter((c) => typeof c === "string" && c.trim()).length >= 2);
      const hr = h >= 0 ? h + 1 : 1;
      setHeaderRow(hr);
      const hdrs = (first.rows[hr - 1] ?? []).map((x) => String(x ?? "").trim()).filter(Boolean);
      let saved: Mapping | null = null;
      try { saved = JSON.parse(localStorage.getItem(MAP_KEY) ?? "null") as Mapping | null; } catch { /* ignore */ }
      const guessed = guessMapping(hdrs);
      if (saved) for (const [k, v] of Object.entries(saved)) if (v && hdrs.includes(v)) guessed[k as FieldKey] = v;
      setMapping(guessed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    setError(null); setResult(null);
    if (!mapping.item_number) { setError("Choose which column holds the item number."); return; }
    try { localStorage.setItem(MAP_KEY, JSON.stringify(mapping)); } catch { /* ignore */ }
    const norm = normalize(objects, mapping, optionNames);
    if (norm.length === 0) { setError("No rows found under the header row."); return; }
    if (norm.length > 5000) { setError("That's more than 5,000 rows. Split the sheet and import it in parts."); return; }
    setBusy(`Checking ${norm.length} rows…`);
    const res = await previewImport(norm, updateContent);
    setBusy(null);
    if (res.error || !res.data) { setError(res.error ?? "Check failed."); return; }
    setRows(norm); setPreview(res.data); setFilter(res.data.summary.error ? "error" : "all");
  }

  async function runAi() {
    if (!rows || !preview) return;
    const newSkus = new Set(preview.rows.filter((r) => r.action === "new").map((r) => r.row));
    const targets = rows.filter((r) => newSkus.has(r.row));
    setError(null);
    const merged = new Map<string, AiSuggestion>();
    for (let i = 0; i < targets.length; i += 20) {
      setBusy(`AI is setting up products… ${Math.min(i + 20, targets.length)} of ${targets.length}`);
      const batch = targets.slice(i, i + 20);
      const res = await suggestWithAi(batch.map((r) => ({ item_number: r.item_number, name: r.name, description: r.description, category: r.category, options: r.options })));
      if (res.error) { setError(res.error); break; }
      for (const s of res.data ?? []) merged.set(s.item_number, s);
      setAiDone(merged.size);
    }
    setBusy(null);
    setRows((prev) => prev?.map((r) => {
      const s = merged.get(r.item_number);
      if (!s) return r;
      return {
        ...r,
        title: r.title ?? s.title,
        description: r.description ?? s.description,
        category: r.category ?? s.category,
        occasions: r.occasions?.length ? r.occasions : s.occasions,
        recipients: r.recipients?.length ? r.recipients : s.recipients,
        tags: r.tags?.length ? r.tags : s.tags,
        seo_title: r.seo_title ?? s.seo_title,
        seo_description: r.seo_description ?? s.seo_description,
      };
    }) ?? null);
  }

  function edit(rowNo: number, patch: Partial<ImportRow>) {
    setRows((prev) => prev?.map((r) => (r.row === rowNo ? { ...r, ...patch } : r)) ?? null);
  }

  async function apply() {
    if (!rows || !preview) return;
    const todo = new Set(preview.rows.filter((r) => r.action === "new" || r.action === "update").map((r) => r.row));
    const send = rows.filter((r) => todo.has(r.row));
    const total: ApplyResult = { created_products: 0, created_items: 0, updated: 0, unchanged: 0, errors: [] };
    setError(null);
    for (let i = 0; i < send.length; i += 200) {
      setBusy(`Importing… ${Math.min(i + 200, send.length)} of ${send.length}`);
      const res = await applyImport(send.slice(i, i + 200), updateContent, publish);
      if (res.error || !res.data) { setError(res.error ?? "Import failed."); break; }
      total.created_products += res.data.created_products;
      total.created_items += res.data.created_items;
      total.updated += res.data.updated;
      total.unchanged += res.data.unchanged;
      total.errors.push(...res.data.errors);
    }
    setBusy(null);
    setResult(total);
    setPreview(null);
  }

  const rowByNo = useMemo(() => new Map((rows ?? []).map((r) => [r.row, r])), [rows]);
  const shown = (preview?.rows ?? []).filter((r) => filter === "all" || r.action === filter).slice(0, 500);
  const newCount = preview?.summary.new ?? 0;

  return (
    <div className="space-y-6">
      {error && <Notice tone="bad">{error}</Notice>}
      {busy && <Notice tone="warn">{busy}</Notice>}

      <Panel title="1. Choose the sheet">
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void readFile(f); }}
          className={`flex h-36 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-sm ${dragging ? "border-ink bg-white" : "border-line bg-canvas/50"} hover:border-ink`}>
          <span className="font-medium text-ink">{fileName ?? "Drop your Excel or CSV file here"}</span>
          <span className="text-xs text-muted">or click to choose · .xlsx, .xls or .csv · read on this computer, not uploaded</span>
          <input ref={input} type="file" className="sr-only" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
        </label>
        {sheets.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            {sheets.length > 1 && (
              <label className="text-xs font-medium text-muted">Tab
                <select value={sheetIdx} onChange={(e) => setSheetIdx(Number(e.target.value))} className="mt-1 block rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink">
                  {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} rows)</option>)}
                </select>
              </label>
            )}
            <label className="text-xs font-medium text-muted">Header row
              <input type="number" min={1} max={20} value={headerRow} onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))}
                     className="mt-1 block w-24 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink" />
            </label>
            <p className="self-end pb-2 text-muted">{objects.length} data rows</p>
          </div>
        )}
      </Panel>

      {sheets.length > 0 && (
        <Panel title="2. Match the columns">
          <p className="mb-4 text-sm text-muted">We guessed from your column names. Fix anything that&apos;s wrong — we&apos;ll remember it for next time.</p>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="block text-xs font-medium text-muted">
                {f.label}{f.key === "item_number" && <span className="text-bad"> *</span>}
                <select value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || undefined })}
                        className="mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink">
                  <option value="">— not in sheet —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
                <span className="mt-0.5 block font-normal">
                  {mapping[f.key] ? <>e.g. <span className="text-ink">{String(sample[mapping[f.key]!] ?? "").slice(0, 40) || "(blank)"}</span></> : f.hint}
                </span>
              </label>
            ))}
          </div>
          {(mapping.option1 || mapping.option2) && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted">Option 1 is called
                <input value={optionNames[0]} onChange={(e) => setOptionNames([e.target.value, optionNames[1]])} className="mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink" />
              </label>
              <label className="text-xs font-medium text-muted">Option 2 is called
                <input value={optionNames[1]} onChange={(e) => setOptionNames([optionNames[0], e.target.value])} className="mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink" />
              </label>
            </div>
          )}
          <div className="mt-5 space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={updateContent} onChange={(e) => setUpdateContent(e.target.checked)} className="mt-0.5 size-4 accent-ink" />
              <span>Also update <strong>names, descriptions and categories</strong> of products already in the shop. <span className="text-muted">Off: existing products only get cost, stock, location, barcode and pack updates — anything you&apos;ve polished for customers stays.</span></span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} className="mt-0.5 size-4 accent-ink" />
              <span>Put <strong>new</strong> products on sale right away. <span className="text-muted">Off: they&apos;re saved as drafts so you can add photos first.</span></span>
            </label>
          </div>
          <div className="mt-5"><Button onClick={check} disabled={!!busy}>Check the sheet</Button></div>
        </Panel>
      )}

      {preview && rows && (
        <Panel title="3. Review before importing">
          <div className="flex flex-wrap gap-2 text-sm">
            {([["all", `All ${preview.rows.length}`], ["new", `${preview.summary.new} new`], ["update", `${preview.summary.update} updates`],
               ["same", `${preview.summary.same} unchanged`], ["error", `${preview.summary.error} problems`]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)}
                      className={`rounded-full border px-3 py-1 ${filter === k ? "border-ink bg-ink text-white" : "border-line bg-white"} ${k === "error" && preview.summary.error ? "text-bad" : ""}`}>
                {label}
              </button>
            ))}
          </div>

          {newCount > 0 && (
            <div className="mt-4 rounded-xl border border-line bg-white p-4 text-sm">
              <p className="font-medium">Set up {newCount} new products with AI</p>
              <p className="mt-1 text-muted">
                Writes a customer-friendly name, description, category, occasions, who it&apos;s for, keywords and SEO text from the supplier&apos;s name.
                You can edit everything below before importing. Costs and stock are never sent to the AI.
              </p>
              {aiName
                ? <Button className="mt-3" variant="secondary" onClick={runAi} disabled={!!busy}>{aiDone ? `Done for ${aiDone} — run again` : `Suggest with AI (${aiName})`}</Button>
                : <p className="mt-2 text-warn">Add a free GEMINI_API_KEY in Vercel (giftora-staff) to turn this on.</p>}
            </div>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="py-2 pr-3">Row</th><th className="pr-3">Item no.</th><th className="pr-3">What happens</th><th className="pr-3">Product</th><th>Details</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((p) => {
                  const r = rowByNo.get(p.row);
                  return (
                    <tr key={p.row} className="align-top">
                      <td className="py-2 pr-3 text-muted">{p.row}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{p.sku ?? r?.item_number ?? "—"}</td>
                      <td className="py-2 pr-3"><Badge action={p.action} /></td>
                      <td className="py-2 pr-3 min-w-56">
                        {p.action === "new" && r ? (
                          <div className="space-y-1">
                            <input value={r.title ?? r.name ?? ""} onChange={(e) => edit(r.row, { title: e.target.value })}
                                   className="w-full rounded border border-line px-2 py-1" aria-label="Product name" />
                            <input value={r.category ?? ""} onChange={(e) => edit(r.row, { category: e.target.value })} placeholder="Category"
                                   className="w-full rounded border border-line px-2 py-1 text-xs" aria-label="Category" />
                            {r.title && r.name && r.title !== r.name && <p className="text-xs text-muted">Supplier: {r.name}</p>}
                          </div>
                        ) : p.name ?? r?.name ?? "—"}
                      </td>
                      <td className="py-2 text-xs">
                        {p.changes?.map((c) => (
                          <p key={c.field}><span className="text-muted">{c.field}:</span> {c.field === "cost" ? cad(c.from) : String(c.from ?? "—")} → <strong>{c.field === "cost" ? cad(c.to) : String(c.to)}</strong></p>
                        ))}
                        {p.action === "new" && r && (
                          <>
                            <p className="text-muted">Cost {cad(r.cost_cents)} · stock {r.on_hand_qty ?? "—"} · {r.aisle_location ?? "no location"}{r.options ? ` · ${Object.values(r.options).join(" / ")}` : ""}</p>
                            {r.description && (
                              <textarea value={r.description} onChange={(e) => edit(r.row, { description: e.target.value })} rows={2}
                                        className="mt-1 w-full rounded border border-line px-2 py-1" aria-label="Description" />
                            )}
                            {(r.occasions?.length || r.recipients?.length) ? <p className="text-muted">{[...(r.occasions ?? []), ...(r.recipients ?? [])].join(", ")}</p> : null}
                          </>
                        )}
                        {p.messages?.map((m) => <p key={m} className={p.action === "error" ? "text-bad" : "text-warn"}>{m}</p>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {preview.rows.filter((r) => filter === "all" || r.action === filter).length > 500 && <p className="mt-2 text-xs text-muted">Showing the first 500.</p>}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={apply} disabled={!!busy || preview.summary.new + preview.summary.update === 0}>
              Import {preview.summary.new} new and {preview.summary.update} updates
            </Button>
            {preview.summary.error > 0 && <span className="text-sm text-muted">Rows with problems are skipped. Fix them in the sheet and upload it again any time.</span>}
          </div>
        </Panel>
      )}

      {result && (
        <Panel title="Done">
          <p className="text-sm">
            Added <strong>{result.created_products}</strong> products ({result.created_items} items) and updated <strong>{result.updated}</strong>.
            {result.errors.length > 0 && <> <span className="text-bad">{result.errors.length} rows were skipped.</span></>}
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-bad">{result.errors.slice(0, 50).map((e) => <li key={`${e.row}-${e.sku}`}>Row {e.row} ({e.sku ?? "no item number"}): {e.message}</li>)}</ul>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/products/photos" className="inline-flex h-9 items-center rounded-lg bg-ink px-4 text-sm text-white">Upload photos next</Link>
            <Link href="/products" className="inline-flex h-9 items-center rounded-lg border border-line bg-white px-4 text-sm">See products</Link>
          </div>
        </Panel>
      )}
    </div>
  );
}

function Badge({ action }: { action: PlanRow["action"] }) {
  const s = { new: ["New", "bg-ok/10 text-ok"], update: ["Update", "bg-warn/15 text-ink"], same: ["No change", "bg-line text-muted"], error: ["Problem", "bg-bad/10 text-bad"] }[action];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s[1]}`}>{s[0]}</span>;
}
