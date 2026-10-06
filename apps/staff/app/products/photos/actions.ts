"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PhotoTarget { product_id: string; variant_id: string; sku: string; product: string; multi_variant: boolean; existing: string[] }

/** Looks up which products the given item numbers belong to. */
export async function photoTargets(names: string[]): Promise<Record<string, PhotoTarget>> {
  const staff = await requireStaff("catalog.edit");
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 5000);
  const { data, error } = await createAdminClient().rpc("svc_photo_targets", { p_actor: staff.userId, p_names: unique });
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, PhotoTarget>;
}

/** Records an uploaded photo (skips one already uploaded under the same file name). */
export async function registerNamedPhoto(t: { productId: string; variantId: string | null; url: string; alt: string; sourceName: string }) {
  const staff = await requireStaff("catalog.edit");
  const { data, error } = await createAdminClient().rpc("svc_image_add_named", {
    p_actor: staff.userId, p_product_id: t.productId, p_url: t.url, p_alt: t.alt, p_source_name: t.sourceName, p_variant_id: t.variantId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/products/${t.productId}`);
  return { added: data !== null };
}
