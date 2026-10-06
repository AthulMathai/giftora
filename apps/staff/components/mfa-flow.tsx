"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Stage =
  | { kind: "loading" }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "verify"; factorId: string }
  | { kind: "error"; message: string };

export function MfaFlow() {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setStage({ kind: "error", message: error.message });
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) return setStage({ kind: "verify", factorId: verified.id });
      // Clear half-finished enrollments, then start a fresh one.
      for (const f of data.all.filter((f) => f.status === "unverified")) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: en, error: enErr } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
      if (enErr || !en) return setStage({ kind: "error", message: enErr?.message ?? "Could not start setup" });
      setStage({ kind: "enroll", factorId: en.id, qr: en.totp.qr_code, secret: en.totp.secret });
    })();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (stage.kind !== "enroll" && stage.kind !== "verify") return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: stage.factorId, code: code.trim() });
    if (error) {
      setError("That code didn't work. Codes change every 30 seconds — try the current one.");
      setBusy(false);
      return;
    }
    window.location.href = "/";
  }

  if (stage.kind === "loading") return <p className="mt-4 text-sm text-muted">Loading…</p>;
  if (stage.kind === "error") return <p className="mt-4 text-sm text-bad">{stage.message}</p>;

  return (
    <form onSubmit={submit} className="mt-4 space-y-4 text-sm">
      {stage.kind === "enroll" ? (
        <>
          <p className="text-muted">Scan this with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={stage.qr} alt="Authenticator QR code" className="mx-auto size-48 rounded-lg bg-white p-2" />
          <p className="break-all text-xs text-muted">Can&apos;t scan? Enter this key: <code>{stage.secret}</code></p>
        </>
      ) : (
        <p className="text-muted">Enter the 6-digit code from your authenticator app.</p>
      )}
      <input
        value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code"
        pattern="[0-9]{6}" maxLength={6} required autoFocus aria-label="6-digit code"
        className="block w-full rounded-lg border border-line px-3 py-2 text-center text-2xl tracking-[0.4em]"
      />
      {error && <p role="alert" className="text-bad">{error}</p>}
      <button disabled={busy} className="h-10 w-full rounded-lg bg-ink text-white disabled:opacity-50">
        {busy ? "Checking…" : "Verify"}
      </button>
    </form>
  );
}
