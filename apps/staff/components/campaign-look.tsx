"use client";

import { useState } from "react";
import { slugify } from "@/lib/slug";
import { Input } from "./form";

interface Look {
  name: string; slug: string; eyebrow: string; headline: string; subheadline: string; cta_label: string;
  accent_color: string; background_color: string; ink_color: string;
}

/** Name, banner wording and colours, with a live preview of the home-page banner. */
export function CampaignLook({ initial }: { initial: Look }) {
  const [v, setV] = useState(initial);
  const set = (k: keyof Look) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const suggested = slugify(v.name);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Input label="Name" name="name" value={v.name} onChange={set("name")} required minLength={2} maxLength={80}
             placeholder="Christmas" hint="Only staff see this." />
      <Input label="Web address (slug)" name="slug" value={v.slug} onChange={set("slug")} placeholder={suggested || "christmas"}
             hint={v.slug ? <>The season&apos;s page uses <code>{slugify(v.slug)}</code> in its web address.</>
                          : suggested ? <>Leave blank to use <code>{suggested}</code>.</> : "Leave blank to create it from the name."} />
      <Input label="Small heading above the headline" name="eyebrow" value={v.eyebrow} onChange={set("eyebrow")} placeholder="Christmas 2026" />
      <Input label="Headline" name="headline" value={v.headline} onChange={set("headline")} required placeholder="The merriest gifts, found early." />
      <Input label="Subheadline" name="subheadline" value={v.subheadline} onChange={set("subheadline")} className="md:col-span-2"
             placeholder="Thoughtful presents for everyone on your list, shipped across Canada." />
      <Input label="Button text" name="cta_label" value={v.cta_label} onChange={set("cta_label")} placeholder="Shop the collection" />
      <div className="grid grid-cols-3 gap-3">
        <ColourInput label="Background" name="background_color" value={v.background_color} onChange={set("background_color")} />
        <ColourInput label="Text" name="ink_color" value={v.ink_color} onChange={set("ink_color")} />
        <ColourInput label="Button" name="accent_color" value={v.accent_color} onChange={set("accent_color")} />
      </div>

      <figure className="md:col-span-2">
        <figcaption className="mb-1 text-xs font-medium text-muted">Preview of the home-page banner</figcaption>
        <div className="rounded-xl border border-line px-6 py-8" style={{ background: v.background_color, color: v.ink_color }}>
          {v.eyebrow && <p className="text-xs font-semibold uppercase tracking-widest opacity-80">{v.eyebrow}</p>}
          <p className="mt-2 text-2xl font-semibold leading-tight">{v.headline || "Your headline"}</p>
          {v.subheadline && <p className="mt-2 max-w-xl text-sm opacity-80">{v.subheadline}</p>}
          <span className="mt-5 inline-flex h-10 items-center rounded-full px-5 text-sm font-medium text-white" style={{ background: v.accent_color }}>
            {v.cta_label || "Shop the collection"}
          </span>
        </div>
      </figure>
    </div>
  );
}

function ColourInput({ label, name, value, onChange }: {
  label: string; name: string; value: string; onChange: (e: { target: { value: string } }) => void;
}) {
  return (
    <label className="block text-xs font-medium text-muted">
      {label}
      <span className="mt-1 flex items-center gap-2 rounded-lg border border-line bg-white px-2 py-1.5">
        <input type="color" name={name} value={value} onChange={onChange} className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0" />
        <span className="font-mono text-xs text-ink">{value}</span>
      </span>
    </label>
  );
}
