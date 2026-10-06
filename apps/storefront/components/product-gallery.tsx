"use client";

import Image from "next/image";
import { useState } from "react";

export function ProductGallery({ images, name }: { images: { url: string; alt_text: string }[]; name: string }) {
  const [active, setActive] = useState(0);
  if (images.length === 0) {
    return (
      <div className="aspect-square rounded-3xl bg-linear-to-br from-[#f3d9c9] to-[#e9b9a4] grid place-items-center">
        <span aria-hidden className="font-display text-9xl text-ink/20">{name.charAt(0)}</span>
      </div>
    );
  }
  const main = images[Math.min(active, images.length - 1)]!;
  return (
    <div>
      <div className="relative aspect-square overflow-hidden rounded-3xl bg-paper">
        <Image src={main.url} alt={main.alt_text} fill priority sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {images.map((img, i) => (
            <button key={img.url} type="button" onClick={() => setActive(i)} aria-label={`Show photo ${i + 1}`}
                    className={`relative size-20 shrink-0 overflow-hidden rounded-xl border-2 ${i === active ? "border-ink" : "border-transparent"}`}>
              <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
