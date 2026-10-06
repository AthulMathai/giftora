import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { OCCASIONS, RECIPIENTS, BUDGETS } from "@/lib/discovery";
import { breadcrumbLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Gifts by occasion, person and budget",
  description: "Find the right gift by occasion, who it's for, or how much you want to spend. Shipped across Canada.",
  alternates: { canonical: "/occasions" },
};

export default function OccasionsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "/" }, { name: "Occasions", path: "/occasions" }])} />
      <h1 className="font-display text-4xl sm:text-5xl tracking-tight">Find the right gift</h1>
      <Group title="By occasion">
        {OCCASIONS.map((o) => <Tile key={o.slug} href={`/occasions/${o.slug}`} title={o.name} text={o.intro} />)}
      </Group>
      <Group title="By who it's for">
        {RECIPIENTS.map((r) => <Tile key={r.slug} href={`/gifts-for/${r.slug}`} title={r.title} />)}
      </Group>
      <Group title="By budget">
        {BUDGETS.map((b) => <Tile key={b} href={`/gifts-under/${b}`} title={`Gifts under $${b}`} />)}
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-2xl">{title}</h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function Tile({ href, title, text }: { href: string; title: string; text?: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-line bg-paper p-5 transition hover:border-ink">
      <span className="font-medium">{title} →</span>
      {text && <span className="mt-1 block text-sm text-muted">{text}</span>}
    </Link>
  );
}
