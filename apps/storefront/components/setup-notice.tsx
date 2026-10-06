export function SetupNotice() {
  return (
    <div className="mx-auto max-w-xl my-16 rounded-2xl border border-line bg-paper p-6 text-sm">
      <p className="font-medium">The store isn&apos;t connected to its database yet.</p>
      <p className="mt-2 text-muted">
        Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in
        <code> apps/storefront/.env.local</code> (or the Vercel project settings), then reload.
      </p>
    </div>
  );
}
