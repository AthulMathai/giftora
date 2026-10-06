import type { ReactNode } from "react";
import { breadcrumbLd } from "@/lib/seo";
import { JsonLd } from "./json-ld";

export function ProsePage({ title, path, intro, children, extraLd }: { title: string; path: string; intro?: string; children: ReactNode; extraLd?: object | null }) {
  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-12">
      <JsonLd data={[breadcrumbLd([{ name: "Home", path: "/" }, { name: title, path }]), extraLd ?? null]} />
      <h1 className="font-display text-4xl sm:text-5xl tracking-tight">{title}</h1>
      {intro && <p className="mt-4 text-lg text-muted">{intro}</p>}
      <div className="mt-10 space-y-6 leading-relaxed [&_h2]:mt-12 [&_h2]:font-display [&_h2]:text-2xl [&_a]:underline [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1">
        {children}
      </div>
    </article>
  );
}
