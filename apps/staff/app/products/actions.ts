"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { friendly, list, parseMoney, slugify } from "@/lib/catalog";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "product-images";

function back(path: string, error: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(friendly(error))}`);
}

export async function saveProduct(formData: FormData) {
  const staff = await requireStaff("catalog.edit");
  const id = String(formData.get("id") ?? "") || null;
  const name = String(formData.get("name") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? "") || name);
  const here = id ? `/products/${id}` : "/products/new";

  const { data, error } = await createAdminClient().rpc("svc_product_save", {
    p_actor: staff.userId,
    p: {
      id, name, slug,
      description: formData.get("description"),
      category_id: formData.get("category_id"),
      status: formData.get("status"),
      tags: list(formData.get("tags")),
      occasions: list(formData.get("occasions")),
      recipients: list(formData.get("recipients")),
      option_names: list(formData.get("option_names")),
      seo_title: formData.get("seo_title"),
      seo_description: formData.get("seo_description"),
    },
  });
  if (error) back(here, error.message);
  revalidatePath("/products");
  redirect(`/products/${data}?saved=1`);
}

export async function saveVariant(formData: FormData) {
  const staff = await requireStaff("catalog.edit");
  const productId = String(formData.get("product_id") ?? "");
  const here = `/products/${productId}`;
  const optionNames = list(formData.get("option_names"));
  const options = Object.fromEntries(optionNames.map((n) => [n, String(formData.get(`opt_${n}`) ?? "").trim()]).filter(([, v]) => v));
  const label = String(formData.get("label") ?? "").trim() || Object.values(options).join(" / ") || "Default";

  let cost: number | null = null;
  let compareAt: number | null = null;
  try {
    cost = staff.can("suppliers.edit") ? parseMoney(formData.get("cost")) : null;
    compareAt = parseMoney(formData.get("compare_at"));
  } catch (e) { back(here, (e as Error).message); }

  const qtyRaw = String(formData.get("on_hand_qty") ?? "").trim();
  const p: Record<string, unknown> = {
    id: String(formData.get("id") ?? "") || null,
    product_id: productId,
    sku: String(formData.get("sku") ?? "").trim().toUpperCase(),
    label, options,
    compare_at_cents: compareAt,
    weight_grams: String(formData.get("weight_grams") ?? "").trim() || null,
    is_active: formData.get("is_active") === "on",
  };
  if (cost !== null) {
    Object.assign(p, {
      cost_cents: cost,
      on_hand_qty: qtyRaw === "" ? null : Math.max(0, Math.floor(Number(qtyRaw))),
      supply_status: formData.get("supply_status") || "available",
      supplier_sku: formData.get("supplier_sku"),
      supplier_barcode: formData.get("supplier_barcode"),
      aisle_location: formData.get("aisle_location"),
      inner_qty: String(formData.get("inner_qty") ?? "").trim() || null,
      inner_barcode: formData.get("inner_barcode"),
      outer_qty: String(formData.get("outer_qty") ?? "").trim() || null,
      outer_barcode: formData.get("outer_barcode"),
    });
  }
  const { error } = await createAdminClient().rpc("svc_variant_save", { p_actor: staff.userId, p });
  if (error) back(here, error.message);
  revalidatePath(here);
  redirect(`${here}?saved=variant#variants`);
}

/** Step 1 of a photo upload: a one-time signed URL the browser uploads straight to storage. */
export async function createPhotoUpload(productId: string, fileName: string, contentType: string) {
  await requireStaff("catalog.edit");
  if (!/^image\/(jpeg|png|webp|avif)$/.test(contentType)) throw new Error("Use a JPG, PNG, WebP or AVIF image.");
  const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" } as Record<string, string>)[contentType];
  const safe = fileName.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "photo";
  const path = `${productId}/${Date.now()}-${safe}.${ext}`;
  const storage = createAdminClient().storage.from(BUCKET);
  const { data, error } = await storage.createSignedUploadUrl(path);
  if (error) throw new Error(error.message);
  return { path, token: data.token, publicUrl: storage.getPublicUrl(path).data.publicUrl };
}

/** Step 2: record the uploaded photo on the product. */
export async function registerPhoto(productId: string, publicUrl: string, alt: string) {
  const staff = await requireStaff("catalog.edit");
  const { error } = await createAdminClient().rpc("svc_image_add", {
    p_actor: staff.userId, p_product_id: productId, p_url: publicUrl, p_alt: alt,
  });
  if (error) throw new Error(friendly(error.message));
  revalidatePath(`/products/${productId}`);
}

export async function deletePhoto(formData: FormData) {
  const staff = await requireStaff("catalog.edit");
  const productId = String(formData.get("product_id"));
  const admin = createAdminClient();
  const { data: url } = await admin.rpc("svc_image_delete", { p_actor: staff.userId, p_image_id: String(formData.get("image_id")) });
  const marker = `/object/public/${BUCKET}/`;
  if (typeof url === "string" && url.includes(marker)) {
    await admin.storage.from(BUCKET).remove([decodeURIComponent(url.split(marker)[1]!)]);
  }
  revalidatePath(`/products/${productId}`);
}

export async function makePhotoFirst(formData: FormData) {
  const staff = await requireStaff("catalog.edit");
  await createAdminClient().rpc("svc_image_make_first", { p_actor: staff.userId, p_image_id: String(formData.get("image_id")) });
  revalidatePath(`/products/${String(formData.get("product_id"))}`);
}
