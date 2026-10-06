"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);

export async function addAddress(formData: FormData) {
  const back = safeNext(formData.get("back"), "/account");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(back)}`);

  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const province = str("province").toUpperCase();
  const postal = str("postal_code").toUpperCase().replace(/\s+/g, "");
  if (!PROVINCES.has(province) || !/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(postal)) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}address_error=1`);
  }

  const { data, error } = await supabase.from("addresses").insert({
    user_id: user.id,
    full_name: str("full_name"),
    line1: str("line1"),
    line2: str("line2") || null,
    city: str("city"),
    province,
    postal_code: `${postal.slice(0, 3)} ${postal.slice(3)}`,
    phone: str("phone") || null,
    is_default_shipping: true,
  }).select("id").single();
  if (error) redirect(`${back}${back.includes("?") ? "&" : "?"}address_error=1`);

  // Only one default.
  await supabase.from("addresses").update({ is_default_shipping: false }).neq("id", data.id);
  revalidatePath("/account");
  redirect(`${back}${back.includes("?") ? "&" : "?"}address=${data.id}`);
}

export async function deleteAddress(formData: FormData) {
  const supabase = await createClient();
  await supabase.from("addresses").delete().eq("id", String(formData.get("id") ?? ""));
  revalidatePath("/account");
}
