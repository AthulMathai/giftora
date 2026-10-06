import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Button, Input, Notice, Panel } from "@/components/form";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const FIELDS = ["name", "line1", "line2", "city", "province", "postal_code", "phone"] as const;

async function saveReturnAddress(formData: FormData) {
  "use server";
  const staff = await requireStaff("settings.edit");
  const value = Object.fromEntries(FIELDS.map((f) => [f, String(formData.get(f) ?? "").trim()]));
  const { error } = await createAdminClient().rpc("svc_return_address_save", { p_actor: staff.userId, p: value });
  if (error) redirect("/settings?error=" + encodeURIComponent(error.message));
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const staff = await requireStaff("settings.edit");
  const { saved, error } = await searchParams;
  const { data } = await createAdminClient().rpc("svc_get_setting", { p_key: "shipping.return_address" });
  const a = (data ?? {}) as Record<string, string>;
  void staff;
  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {saved && <Notice tone="ok">Saved. New labels will use this address.</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      <Panel title="Return address on shipping labels">
        <form action={saveReturnAddress} className="grid gap-3 sm:grid-cols-2">
          <Input label="Business name" name="name" defaultValue={a.name ?? "Giftora"} required className="sm:col-span-2" />
          <Input label="Address" name="line1" defaultValue={a.line1} required className="sm:col-span-2" />
          <Input label="Unit / suite" name="line2" defaultValue={a.line2} className="sm:col-span-2" />
          <Input label="City" name="city" defaultValue={a.city} required />
          <Input label="Province" name="province" defaultValue={a.province ?? "ON"} maxLength={2} required />
          <Input label="Postal code" name="postal_code" defaultValue={a.postal_code} required />
          <Input label="Phone" name="phone" defaultValue={a.phone} />
          <div className="sm:col-span-2"><Button>Save</Button></div>
        </form>
      </Panel>
    </div>
  );
}
