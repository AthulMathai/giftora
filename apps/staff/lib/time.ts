/**
 * Conversions between `<input type="datetime-local">` values and stored timestamps.
 * Staff always type Toronto time: "2026-12-01T00:00" means midnight in Toronto,
 * whatever the server's own time zone is. Handles daylight saving changes.
 */
const TZ = "America/Toronto";

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function torontoParts(at: Date): Record<string, number> {
  return Object.fromEntries(parts.formatToParts(at).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
}

/** Milliseconds Toronto is ahead of UTC at this instant (negative: -4h or -5h). */
function offsetMs(at: Date): number {
  const p = torontoParts(at);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** "2026-12-01T00:00" (Toronto) -> ISO string in UTC. Empty or invalid -> null. */
export function torontoLocalToIso(local: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(String(local ?? "").trim());
  if (!m) return null;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  if (Number.isNaN(naive)) return null;
  // Two passes so times right next to a daylight-saving switch land correctly.
  let t = naive - offsetMs(new Date(naive));
  t = naive - offsetMs(new Date(t));
  return new Date(t).toISOString();
}

/** Stored timestamp -> "2026-12-01T00:00" in Toronto time, for a datetime-local input. */
export function isoToTorontoLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = torontoParts(d);
  const two = (n: number | undefined) => String(n ?? 0).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/** "Dec 1, 2026" in Toronto time. */
export function torontoDay(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: TZ }).format(new Date(iso));
}
