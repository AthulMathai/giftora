import { redirect } from "next/navigation";
import { MfaFlow } from "@/components/mfa-flow";
import { getStaffState } from "@/lib/auth";

export const metadata = { title: "Two-factor authentication" };
export const dynamic = "force-dynamic";

export default async function MfaPage() {
  const s = await getStaffState();
  if (s.kind === "signed_out") redirect("/sign-in");
  if (s.kind === "ok") redirect("/");
  if (s.kind === "not_staff") redirect("/sign-in?error=not_staff");
  return (
    <div className="mx-auto mt-10 max-w-sm rounded-xl border border-line bg-panel p-6">
      <h1 className="text-lg font-semibold">Two-factor authentication</h1>
      <MfaFlow />
    </div>
  );
}
