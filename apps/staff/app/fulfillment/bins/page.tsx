import Link from "next/link";
import { Button, Input, Notice } from "@/components/form";
import { PrintButton } from "@/components/print-button";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { addBins } from "../actions";

export const metadata = { title: "Bins" };
export const dynamic = "force-dynamic";

export default async function BinsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const staff = await requireStaff("fulfillment.operate");
  const { error } = await searchParams;
  const { data } = await createAdminClient().rpc("svc_bins", { p_actor: staff.userId });
  const bins = (data ?? []) as { id: string; code: string; status: string; order_number: string | null }[];
  const inUse = bins.filter((b) => b.status === "assigned").length;

  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <Link href="/fulfillment" className="text-sm text-muted hover:text-ink">← Fulfillment</Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Bins</h1>
            <p className="text-sm text-muted">{bins.length} bins · {inUse} in use · bins free up automatically when their order ships.</p>
          </div>
          <div className="flex items-end gap-2">
            <form action={addBins} className="flex items-end gap-2">
              <Input label="Add bins" name="count" defaultValue="10" inputMode="numeric" className="w-24" />
              <Button variant="secondary">Add</Button>
            </form>
            <PrintButton />
          </div>
        </div>
        {error && <div className="mt-3"><Notice tone="bad">{error}</Notice></div>}
        <p className="mt-2 text-xs text-muted">Print this page and stick each label on a physical bin.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 print:grid-cols-4">
        {bins.map((b) => (
          <div key={b.id} className={`break-inside-avoid rounded-xl border-2 p-4 text-center ${b.status === "assigned" ? "border-accent" : "border-ink"}`}>
            <p className="text-3xl font-bold tracking-tight">{b.code}</p>
            <p className="mt-1 text-xs text-muted print:hidden">{b.status === "assigned" ? b.order_number : b.status.replace(/_/g, " ")}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
