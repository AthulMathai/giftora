import Link from "next/link";
import { NewOrderForm } from "@/components/new-order-form";
import { requireStaff } from "@/lib/auth";

export const metadata = { title: "New order" };
export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  await requireStaff("orders.edit");
  return (
    <div className="space-y-6">
      <div>
        <Link href="/orders" className="text-sm text-muted hover:text-ink">← Orders</Link>
        <h1 className="mt-2 text-2xl font-semibold">New order</h1>
        <p className="mt-1 text-sm text-muted">
          For customers who order by phone, in person, on Instagram or Facebook, by email or through a marketplace.
          The order then goes through batches, labels and shipping like any web order.
        </p>
      </div>
      <NewOrderForm />
    </div>
  );
}
