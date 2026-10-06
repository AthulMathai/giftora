"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createPhotoUpload, registerPhoto } from "@/app/products/actions";
import { createClient } from "@/lib/supabase/client";

/** Uploads straight from the browser to storage with a one-time signed URL, then records the photo. */
export function PhotoUploader({ productId, productName }: { productId: string; productName: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const supabase = createClient();
    try {
      for (const [i, file] of Array.from(files).entries()) {
        if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} is over 5 MB.`);
        setBusy(`Uploading ${i + 1} of ${files.length}…`);
        const { path, token, publicUrl } = await createPhotoUpload(productId, file.name, file.type);
        const { error } = await supabase.storage.from("product-images").uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (error) throw new Error(error.message);
        await registerPhoto(productId, publicUrl, productName);
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <label className="flex h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-canvas/50 text-sm text-muted hover:border-ink">
        <span className="font-medium text-ink">{busy ?? "Add photos"}</span>
        <span className="text-xs">JPG, PNG or WebP, up to 5 MB each</span>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="sr-only"
               disabled={!!busy} onChange={(e) => upload(e.target.files)} />
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
