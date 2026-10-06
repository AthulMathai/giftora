import type { ComponentProps, ReactNode } from "react";

export function Field({ label, hint, ...input }: { label: string; hint?: string } & ComponentProps<"input">) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <input
        {...input}
        className="mt-1.5 block w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-base outline-none focus:border-ink"
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function SubmitButton({ children, className = "", ...rest }: ComponentProps<"button">) {
  return (
    <button
      {...rest}
      className={`inline-flex h-12 items-center justify-center rounded-full bg-ink px-7 text-cream transition hover:bg-coral disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-paper p-6 ${className}`}>{children}</div>;
}

export function Alert({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "info" }) {
  const styles = tone === "error" ? "border-coral/40 bg-coral/5 text-coral-dark" : "border-sage/40 bg-sage/10 text-ink";
  return <p role="alert" className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</p>;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="font-display text-4xl tracking-tight">{children}</h1>
      {sub && <p className="mt-2 text-muted">{sub}</p>}
    </div>
  );
}
