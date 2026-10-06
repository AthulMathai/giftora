"use client";

import Link from "next/link";
import { useState } from "react";
import { createPhotoUpload } from "@/app/products/actions";
import { photoTargets, registerNamedPhoto, type PhotoTarget } from "@/app/products/photos/actions";
import { itemFromFileName } from "@/lib/import";
import { createClient } from "@/lib/supabase/client";
import { Button, Notice, Panel } from "./form";

type Item = { file: File; folder?: string; candidates: string[]; target?: PhotoTarget; status: "ready" | "nomatch" | "exists" | "done" | "skipped" | "failed"; note?: string };

const IMAGE = /\.(jpe?g|png|webp|avif|heic)$/i;

/** Reads files out of dropped folders (Chrome, Edge, Safari, Firefox). */
async function filesFromDrop(items: DataTransferItemList): Promise<{ file: File; folder?: string }[]> {
  const out: { file: File; folder?: string }[] = [];
  type Entry = { isFile: boolean; isDirectory: boolean; name: string; file?: (cb: (f: File) => void, err: (e: unknown) => void) => void; createReader?: () => { readEntries: (cb: (e: Entry[]) => void, err: (e: unknown) => void) => void } };
  async function walk(entry: Entry, folder?: string) {
    if (entry.isFile && entry.file) {
      const file = await new Promise<File>((res, rej) => entry.file!(res, rej));
      out.push({ file, folder });
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise<Entry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        for (const e of batch) await walk(e, entry.name);
      }
    }
  }
  const entries = Array.from(items).map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.()).filter(Boolean) as Entry[];
  for (const e of entries) await walk(e);
  return out;
}

/** Shrinks big photos to at most 2000px (WebP) so uploads are fast and pages stay quick. */
async function prepare(file: File): Promise<{ blob: Blob; type: string; name: string }> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(file.type)) return { blob: file, type: file.type, name: file.name };
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.86));
    if (blob) return { blob, type: "image/webp", name: file.name.replace(/\.[^.]+$/, ".webp") };
  } catch { /* fall back to the original */ }
  return { blob: file, type: file.type || "image/jpeg", name: file.name };
}

export function BulkPhotos() {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function load(list: { file: File; folder?: string }[]) {
    setError(null);
    const imgs = list.filter((x) => IMAGE.test(x.file.name))
      .sort((a, b) => (a.folder ?? "").localeCompare(b.folder ?? "") || a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
    if (imgs.length === 0) { setError("No photos found. Use JPG, PNG or WebP files named by item number."); return; }
    setBusy(`Matching ${imgs.length} photos to products…`);
    try {
      const parsed = imgs.map((x) => ({ ...x, candidates: itemFromFileName(x.file.name, x.folder).candidates }));
      const targets = await photoTargets(parsed.flatMap((p) => p.candidates));
      setItems(parsed.map((p) => {
        const hit = p.candidates.find((c) => targets[c]);
        const target = hit ? targets[hit] : undefined;
        if (!target) return { ...p, status: "nomatch" as const };
        if (target.existing.includes(p.file.name) || target.existing.includes(p.file.name.replace(/\.[^.]+$/, ".webp")))
          return { ...p, target, status: "exists" as const };
        return { ...p, target, status: "ready" as const };
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function upload() {
    const supabase = createClient();
    const todo = items.map((it, i) => ({ it, i })).filter(({ it }) => it.status === "ready");
    let n = 0;
    for (const { it, i } of todo) {
      n++;
      setBusy(`Uploading ${n} of ${todo.length}…`);
      try {
        const t = it.target!;
        const ready = await prepare(it.file);
        if (ready.blob.size > 5 * 1024 * 1024) throw new Error("Over 5 MB even after shrinking");
        const { path, token, publicUrl } = await createPhotoUpload(t.product_id, ready.name, ready.type);
        const { error } = await supabase.storage.from("product-images").uploadToSignedUrl(path, token, ready.blob, { contentType: ready.type });
        if (error) throw new Error(error.message);
        const res = await registerNamedPhoto({ productId: t.product_id, variantId: t.multi_variant ? t.variant_id : null, url: publicUrl, alt: t.product, sourceName: it.file.name });
        setItems((prev) => prev.map((x, j) => (j === i ? { ...x, status: res.added ? "done" : "skipped" } : x)));
      } catch (e) {
        setItems((prev) => prev.map((x, j) => (j === i ? { ...x, status: "failed", note: (e as Error).message } : x)));
      }
    }
    setBusy(null);
  }

  const count = (s: Item["status"]) => items.filter((i) => i.status === s).length;

  return (
    <div className="space-y-6">
      {error && <Notice tone="bad">{error}</Notice>}
      {busy && <Notice tone="warn">{busy}</Notice>}
      <Panel title="Drop photo folders or files">
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={async (e) => { e.preventDefault(); setDragging(false); await load(await filesFromDrop(e.dataTransfer.items)); }}
          className={`flex h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center text-sm ${dragging ? "border-ink bg-white" : "border-line bg-canvas/50"} hover:border-ink`}>
          <span className="font-medium text-ink">Drop folders or photos here</span>
          <span className="mt-1 max-w-md text-xs text-muted">
            Name each photo by item number — <code>HD-BLK-M.jpg</code>, <code>HD-BLK-M-2.jpg</code>, <code>HD-BLK-M (3).jpg</code> — or put them in a folder named by item number. Big photos are shrunk automatically.
          </span>
          <input type="file" multiple accept="image/*" className="sr-only"
                 onChange={(e) => { void load(Array.from(e.target.files ?? []).map((file) => ({ file }))); e.target.value = ""; }} />
        </label>
        <p className="mt-3 text-xs text-muted">
          Or{" "}
          <label className="cursor-pointer underline">choose a whole folder
            <input type="file" multiple className="sr-only" {...({ webkitdirectory: "" } as Record<string, string>)}
                   onChange={(e) => {
                     void load(Array.from(e.target.files ?? []).map((file) => {
                       const parts = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/") ?? [];
                       return { file, folder: parts.length > 2 ? parts[parts.length - 2] : undefined };
                     }));
                     e.target.value = "";
                   }} />
          </label>
          . To add one photo at a time, open the product and use its photo box.
        </p>
      </Panel>

      {items.length > 0 && (
        <Panel title={`${items.length} photos`}>
          <p className="text-sm">
            <strong>{count("ready")}</strong> ready · {count("exists")} already uploaded · <span className={count("nomatch") ? "text-bad" : ""}>{count("nomatch")} no matching item</span>
            {count("done") > 0 && <> · <span className="text-ok">{count("done")} uploaded</span></>}
            {count("failed") > 0 && <> · <span className="text-bad">{count("failed")} failed</span></>}
          </p>
          <div className="mt-4">
            <Button onClick={upload} disabled={!!busy || count("ready") === 0}>Upload {count("ready")} photos</Button>
          </div>
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-2">Photo</th><th>Product</th><th>Status</th></tr></thead>
            <tbody className="divide-y divide-line">
              {items.slice(0, 1000).map((it, i) => (
                <tr key={`${it.folder ?? ""}/${it.file.name}-${i}`}>
                  <td className="py-1.5 font-mono text-xs">{it.folder ? `${it.folder}/` : ""}{it.file.name}</td>
                  <td>{it.target ? <Link href={`/products/${it.target.product_id}`} className="underline">{it.target.product}</Link> : <span className="text-muted">Tried {it.candidates.join(", ")}</span>}
                    {it.target?.multi_variant && <span className="text-xs text-muted"> · {it.target.sku}</span>}</td>
                  <td className="text-xs">{{
                    ready: "Ready", nomatch: <span className="text-bad">No item with that number</span>, exists: <span className="text-muted">Already uploaded</span>,
                    done: <span className="text-ok">Uploaded</span>, skipped: <span className="text-muted">Already there</span>, failed: <span className="text-bad">Failed: {it.note}</span>,
                  }[it.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
