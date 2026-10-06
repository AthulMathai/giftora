import type { ComponentProps, ReactNode } from "react";

const control = "mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink";

export function Input({ label, hint, className = "", ...rest }: { label: string; hint?: ReactNode } & ComponentProps<"input">) {
  return (
    <label className={`block text-xs font-medium text-muted ${className}`}>
      {label}
      <input {...rest} className={control} />
      {hint && <span className="mt-1 block font-normal">{hint}</span>}
    </label>
  );
}

export function Textarea({ label, hint, className = "", ...rest }: { label: string; hint?: ReactNode } & ComponentProps<"textarea">) {
  return (
    <label className={`block text-xs font-medium text-muted ${className}`}>
      {label}
      <textarea {...rest} className={`${control} min-h-24`} />
      {hint && <span className="mt-1 block font-normal">{hint}</span>}
    </label>
  );
}

export function Select({ label, children, className = "", ...rest }: { label: string; children: ReactNode } & ComponentProps<"select">) {
  return (
    <label className={`block text-xs font-medium text-muted ${className}`}>
      {label}
      <select {...rest} className={control}>{children}</select>
    </label>
  );
}

export function Button({ variant = "primary", className = "", ...rest }: { variant?: "primary" | "secondary" | "danger" } & ComponentProps<"button">) {
  const styles = {
    primary: "bg-ink text-white hover:bg-ink/90",
    secondary: "border border-line bg-white hover:border-ink",
    danger: "border border-bad/40 text-bad hover:bg-bad/5",
  }[variant];
  return <button {...rest} className={`inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm disabled:opacity-50 ${styles} ${className}`} />;
}

export function Notice({ tone, children }: { tone: "ok" | "bad" | "warn"; children: ReactNode }) {
  const styles = { ok: "border-ok/40 bg-ok/5 text-ok", bad: "border-bad/40 bg-bad/5 text-bad", warn: "border-warn/40 bg-warn/10 text-ink" }[tone];
  return <p role={tone === "bad" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>{children}</p>;
}

export function Panel({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
