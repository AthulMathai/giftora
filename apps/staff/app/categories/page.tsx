import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Button, Input, Notice, Panel } from "@/components/form";
import { requireStaff } from "@/lib/auth";
import { friendly, listCategories, slugify } from "@/lib/catalog";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Categories" };
export const dynamic = "force-dynamic";

async function saveCategory(formData: FormData) {
  "use server";
  const staff = await requireStaff("catalog.edit");
  const name = String(formData.get("name") ?? "").trim();
  const { error } = await createAdminClient().rpc("svc_category_save", {
    p_actor: staff.userId,
    p: {
      id: formData.get("id") || null, name,
      slug: slugify(String(formData.get("slug") ?? "") || name),
      description: formData.get("description"),
      sort_order: Number(formData.get("sort_order") || 0),
      is_visible: formData.get("is_visible") === "on",
    },
  });
  if (error) redirect("/categories?error=" + encodeURIComponent(friendly(error.message)));
  revalidatePath("/categories");
  redirect("/categories?saved=1");
}

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const staff = await requireStaff("catalog.view");
  const { error, saved } = await searchParams;
  const categories = await listCategories(staff.userId);
  const canEdit = staff.can("catalog.edit");

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">Categories</h1>
      {error && <Notice tone="bad">{error}</Notice>}
      {saved && !error && <Notice tone="ok">Saved.</Notice>}
      <div className="space-y-3">
        {categories.map((c) => (
          <form key={c.id} action={saveCategory} className="grid items-end gap-3 rounded-xl border border-line bg-panel p-4 sm:grid-cols-[1fr_1fr_80px_auto_auto]">
            <input type="hidden" name="id" value={c.id} />
            <fieldset disabled={!canEdit} className="contents">
              <Input label={`Name · ${c.products} product${c.products === 1 ? "" : "s"}`} name="name" defaultValue={c.name} required />
              <Input label="Web address" name="slug" defaultValue={c.slug} />
              <Input label="Order" name="sort_order" defaultValue={c.sort_order} inputMode="numeric" />
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="is_visible" defaultChecked={c.is_visible} className="size-4 accent-ink" /> Visible</label>
              {canEdit && <Button variant="secondary">Save</Button>}
            </fieldset>
          </form>
        ))}
      </div>
      {canEdit && (
        <Panel title="New category">
          <form action={saveCategory} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input label="Name" name="name" required placeholder="For Pets" />
            <Input label="Web address (optional)" name="slug" placeholder="for-pets" />
            <input type="hidden" name="is_visible" value="on" />
            <Button>Add category</Button>
          </form>
        </Panel>
      )}
    </div>
  );
}
