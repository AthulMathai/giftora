"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * First-party analytics. A random visitor id (1 year) and session id (30 min idle) live in
 * cookies so server actions can tag add-to-cart and checkout events with the same ids.
 * No IP address, no third parties. Browsers sending Do Not Track / Global Privacy Control
 * are not tracked.
 */

type Payload = Record<string, string | number | null | undefined>;

function cookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function setCookie(name: string, value: string, maxAgeSeconds: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

function newId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function optedOut() {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean };
  return n.globalPrivacyControl === true || n.doNotTrack === "1";
}

function ids() {
  let visitor = cookie("gv");
  if (!visitor) visitor = newId();
  setCookie("gv", visitor, 60 * 60 * 24 * 365);
  let session = cookie("gs");
  const fresh = !session;
  if (!session) session = newId();
  setCookie("gs", session, 60 * 30);
  return { visitor, session, fresh };
}

function device() {
  const w = window.innerWidth;
  return w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop";
}

export function track(event: string, data: Payload = {}) {
  try {
    if (optedOut()) return;
    const { visitor, session } = ids();
    const body = JSON.stringify([{ event, visitor_id: visitor, session_id: session, device: device(), ...data }]);
    if (!navigator.sendBeacon?.("/api/t", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/t", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
    }
  } catch {
    /* analytics must never break the page */
  }
}

/** Page views, plus where the session came from (UTM tags or referring site). */
export function Tracker() {
  const pathname = usePathname();
  const params = useSearchParams();
  const last = useRef<string>("");
  useEffect(() => {
    const key = `${pathname}?${params.toString()}`;
    if (last.current === key) return;
    last.current = key;
    let referrer: string | null = null;
    try {
      const r = document.referrer ? new URL(document.referrer) : null;
      if (r && r.host !== location.host) referrer = r.host.replace(/^www\./, "");
    } catch { /* ignore */ }
    track("page_view", {
      path: pathname,
      referrer_host: referrer,
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
    });
  }, [pathname, params]);
  return null;
}

export function TrackProductView({ productId }: { productId: string }) {
  useEffect(() => { track("product_view", { product_id: productId }); }, [productId]);
  return null;
}

export function TrackSearch({ query, results }: { query: string; results: number }) {
  useEffect(() => { if (query) track("search", { query, results }); }, [query, results]);
  return null;
}

export function TrackCampaign({ slug }: { slug: string }) {
  useEffect(() => { track("campaign_view", { campaign_slug: slug }); }, [slug]);
  return null;
}
