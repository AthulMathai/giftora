import { saveProduct } from "@/app/products/actions";
import { PRODUCT_STATUSES, STATUS_HELP, type Category, type ProductDetail } from "@/lib/catalog";
import { Button, Input, Select, Textarea } from "./form";

export function ProductForm({ product, categories, canEdit }: { product?: ProductDetail; categories: Category[]; canEdit: boolean }) {
  const join = (a?: string[]) => (a ?? []).join(", ");
  return (
    <form action={saveProduct} className="grid gap-4 md:grid-cols-2">
      {product && <input type="hidden" name="id" value={product.id} />}
      <fieldset disabled={!canEdit} className="contents">
        <Input label="Name" name="name" defaultValue={product?.name} required className="md:col-span-2" />
        <Input label="Web address (slug)" name="slug" defaultValue={product?.slug}
               hint="Leave blank to create it from the name. Lowercase, numbers and dashes." />
        <Select label="Status" name="status" defaultValue={product?.status ?? "draft"}>
          {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")} — {STATUS_HELP[s]}</option>)}
        </Select>
        <Select label="Category" name="category_id" defaultValue={product?.category_id ?? ""}>
          <option value="">No category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input label="Options (comma-separated)" name="option_names" defaultValue={join(product?.option_names)}
               placeholder="Size, Colour" hint="The choices customers pick between. Leave blank for a single version." />
        <Textarea label="Description" name="description" defaultValue={product?.description ?? ""} className="md:col-span-2" />
        <Input label="Tags" name="tags" defaultValue={join(product?.tags)} placeholder="mug, coffee, handmade" />
        <Input label="Occasions" name="occasions" defaultValue={join(product?.occasions)} placeholder="birthday, christmas" />
        <Input label="Good for" name="recipients" defaultValue={join(product?.recipients)} placeholder="her, dad, coffee-lover" />
        <div />
        <Input label="Search title (SEO)" name="seo_title" defaultValue={product?.seo_title ?? ""} maxLength={70}
               hint="Shown in Google results. Defaults to the product name." />
        <Input label="Search description (SEO)" name="seo_description" defaultValue={product?.seo_description ?? ""} maxLength={160}
               hint="About 150 characters. Defaults to the description." />
        {canEdit && (
          <div className="md:col-span-2">
            <Button>{product ? "Save product" : "Create product"}</Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
