"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** Records that labels were printed (first print marks the order packed). */
export async function recordLabelPrint(orderIds: string[]) {
  const staff = await requireStaff("fulfillment.operate");
  const admin = createAdminClient();
  for (const id of orderIds) {
    await admin.rpc("svc_label_printed", { p_actor: staff.userId, p_order_id: id });
  }
  revalidatePath("/fulfillment", "layout");
}
