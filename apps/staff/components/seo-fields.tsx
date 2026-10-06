"use client";

import { useRef, useState, useTransition } from "react";
import { suggestSeo } from "@/app/products/actions";
import { Input } from "./form";

const TITLE_MAX = 60;
const DESC_MAX = 160;

/**
 * SEO title + description with character counters and a "Suggest with AI" button.
 * The suggestion only fills the fields; staff review it and click Save to publish.
 */
export function SeoFields({ initialTitle, initialDescription, canSuggest }: {
  initialTitle: string; initialDescription: string; canSuggest: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const button = useRef<HTMLButtonElement>(null);

  function suggest() {
    const form = button.current?.form;
    if (!form) return;
    // Use what's in the form right now, including unsaved edits.
    const fd = new FormData(form);
    const text = (k: string) => String(fd.get(k) ?? "").trim();
    const csv = (k: string) => text(k).split(",").map((s) => s.trim()).filter(Boolean);
    const categorySelect = form.elements.namedItem("category_id");
    const category = categorySelect instanceof HTMLSelectElement && categorySelect.value
      ? categorySelect.selectedOptions[0]?.text : undefined;
    setMessage(null);
    startTransition(async () => {
      const r = await suggestSeo({
        name: text("name"), description: text("description"), category,
        occasions: csv("occasions"), recipients: csv("recipients"), tags: csv("tags"),
      });
      if (r.error) return setMessage({ tone: "bad", text: r.error });
      if (r.seo_title) setTitle(r.seo_title);
      if (r.seo_description) setDescription(r.seo_description);
      setMessage({ tone: "ok", text: "Suggestion filled in. Read it, change anything that isn't right, then click Save — nothing is published until you do." });
    });
  }

  return (
    <>
      <div>
        <Input label="Search title (SEO)" name="seo_title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={70}
               hint={<>Shown in Google results. Defaults to the product name. <Counter n={title.length} max={TITLE_MAX} /></>} />
      </div>
      <div>
        <Input label="Search description (SEO)" name="seo_description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={DESC_MAX}
               hint={<>About 150 characters. Defaults to the description. <Counter n={description.length} max={DESC_MAX} /></>} />
      </div>
      {canSuggest && (
        <div className="md:col-span-2 flex flex-wrap items-center gap-3">
          <button ref={button} type="button" onClick={suggest} disabled={pending}
                  className="inline-flex h-9 items-center rounded-lg border border-line bg-white px-3 text-sm hover:border-ink disabled:opacity-50">
            {pending ? "Writing a suggestion…" : "Suggest with AI"}
          </button>
          {message && <p role={message.tone === "bad" ? "alert" : "status"} className={`text-xs ${message.tone === "bad" ? "text-bad" : "text-muted"}`}>{message.text}</p>}
        </div>
      )}
    </>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  return <span className={`float-right tabular-nums ${n > max ? "text-bad" : ""}`} title={`${n} of about ${max} characters`}>{n}/{max}</span>;
}
