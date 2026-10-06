"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { friendlyCampaignError } from "@/lib/campaigns";
import { slugify } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { torontoLocalToIso } from "@/lib/time";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const colour = (v: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : "");

export async function saveCampaign(formData: FormData) {
  const staff = await requireStaff("marketing.edit");
  const id = str(formData, "id") || null;
  const here = id ? `/campaigns/${id}` : "/campaigns/new";
  const fail: (msg: string) => never = (msg) => redirect(`${here}?error=${encodeURIComponent(friendlyCampaignError(msg))}`);

  const name = str(formData, "name");
  const startsAt = torontoLocalToIso(str(formData, "starts_at"));
  const endsAt = torontoLocalToIso(str(formData, "ends_at"));
  const earlyRaw = str(formData, "early_from");
  const earlyFrom = earlyRaw ? torontoLocalToIso(earlyRaw) : null;
  if (!startsAt || !endsAt) fail("Choose when the campaign starts and ends.");
  if (earlyRaw && !earlyFrom) fail("“Shop early from” isn't a valid date.");

  const qs = formData.getAll("faq_q").map(String);
  const answers = formData.getAll("faq_a").map(String);
  const faq = qs.map((q, i) => ({ q: q.trim(), a: (answers[i] ?? "").trim() })).filter((f) => f.q && f.a);
  if (qs.some((q, i) => !!q.trim() !== !!(answers[i] ?? "").trim())) fail("Each FAQ needs both a question and an answer (or leave both empty).");

  const priority = Number(str(formData, "priority") || 0);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("svc_campaign_save", {
    p_actor: staff.userId,
    p: {
      id, name,
      slug: slugify(str(formData, "slug") || name),
      theme: str(formData, "theme") || "custom",
      occasion: slugify(str(formData, "occasion")) || null,
      eyebrow: str(formData, "eyebrow"),
      headline: str(formData, "headline"),
      subheadline: str(formData, "subheadline"),
      body: str(formData, "body"),
      early_message: str(formData, "early_message"),
      cta_label: str(formData, "cta_label"),
      accent_color: colour(str(formData, "accent_color")),
      background_color: colour(str(formData, "background_color")),
      ink_color: colour(str(formData, "ink_color")),
      early_from: earlyFrom,
      starts_at: startsAt,
      ends_at: endsAt,
      restyle_site: formData.get("restyle_site") === "on",
      priority: Number.isFinite(priority) ? Math.trunc(priority) : 0,
      is_published: formData.get("is_published") === "on",
      seo_title: str(formData, "seo_title"),
      seo_description: str(formData, "seo_description"),
      faq,
    },
  });
  if (error) fail(error.message);
  const savedId = data as string;

  const productIds = [...new Set(formData.getAll("product_ids").map(String).filter(Boolean))];
  const { error: pErr } = await admin.rpc("svc_campaign_products_set", {
    p_actor: staff.userId, p_id: savedId, p_product_ids: productIds,
  });
  if (pErr) redirect(`/campaigns/${savedId}?error=${encodeURIComponent("Campaign saved, but the hand-picked products couldn't be: " + friendlyCampaignError(pErr.message))}`);

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${savedId}`);
  redirect(`/campaigns/${savedId}?saved=1`);
}
