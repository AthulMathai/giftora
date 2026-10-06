import "server-only";
import { redirect } from "next/navigation";
import { createClient, supabaseConfigured } from "./supabase/server";

export type Permission =
  | "catalog.view" | "catalog.edit" | "pricing.edit" | "finance.view"
  | "suppliers.view" | "suppliers.edit" | "orders.view" | "orders.edit"
  | "refunds.create" | "fulfillment.operate" | "fulfillment.override"
  | "customers.view" | "marketing.edit" | "analytics.view" | "audit.view"
  | "staff.manage" | "settings.edit";

export interface StaffSession {
  userId: string;
  email: string | undefined;
  role: string;
  permissions: Set<Permission>;
  can(p: Permission): boolean;
}

export type StaffState =
  | { kind: "signed_out" }
  | { kind: "not_staff" }
  | { kind: "needs_mfa" }
  | { kind: "ok"; staff: StaffSession };

export async function getStaffState(): Promise<StaffState> {
  if (!supabaseConfigured()) return { kind: "signed_out" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { kind: "signed_out" };

  const { data, error } = await supabase.rpc("my_staff_permissions");
  if (error || !data || data.length === 0) return { kind: "not_staff" };
  const rows = data as { role_key: string; permission_key: Permission; require_mfa: boolean }[];

  if (rows[0]!.require_mfa) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") return { kind: "needs_mfa" };
  }
  const permissions = new Set(rows.map((r) => r.permission_key));
  return {
    kind: "ok",
    staff: { userId: user.id, email: user.email, role: rows[0]!.role_key, permissions, can: (p) => permissions.has(p) },
  };
}

export async function getStaff(): Promise<StaffSession | null> {
  const s = await getStaffState();
  return s.kind === "ok" ? s.staff : null;
}

/** Use at the top of every staff page, route handler and server action. */
export async function requireStaff(permission?: Permission): Promise<StaffSession> {
  const s = await getStaffState();
  if (s.kind === "signed_out") redirect("/sign-in");
  if (s.kind === "needs_mfa") redirect("/mfa");
  if (s.kind === "not_staff") redirect("/sign-in?error=not_staff");
  if (permission && !s.staff.can(permission)) redirect("/?denied=" + encodeURIComponent(permission));
  return s.staff;
}
