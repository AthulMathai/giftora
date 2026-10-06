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

/** The signed-in staff member, or null if not signed in / not staff / 2FA missing. */
export async function getStaff(): Promise<StaffSession | null> {
  if (!supabaseConfigured()) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.rpc("my_staff_permissions");
  if (error || !data || data.length === 0) return null;
  const rows = data as { role_key: string; permission_key: Permission; require_mfa: boolean }[];

  // Staff must have completed a second factor in this session.
  if (rows[0]!.require_mfa) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") return null;
  }

  const permissions = new Set(rows.map((r) => r.permission_key));
  return {
    userId: user.id,
    email: user.email,
    role: rows[0]!.role_key,
    permissions,
    can: (p) => permissions.has(p),
  };
}

/** Use at the top of every staff page, route handler and server action. */
export async function requireStaff(permission?: Permission): Promise<StaffSession> {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (permission && !staff.can(permission)) redirect("/?denied=" + encodeURIComponent(permission));
  return staff;
}
