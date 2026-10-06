import Link from "next/link";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

async function cartCount(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.from("cart_items").select("quantity");
  return (data ?? []).reduce((s: number, r: { quantity: number }) => s + r.quantity, 0);
}

export async function SiteHeader() {
  const user = await getUser();
  const count = user ? await cartCount() : 0;
  return (
    <header className="border-b border-line bg-cream/90 backdrop-blur sticky top-0 z-10">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="font-display text-2xl tracking-tight">
          Gift<span className="text-coral">o</span>ra
        </Link>
        <nav className="flex items-center gap-4 sm:gap-5 text-sm">
          <Link href="/shop" className="hover:text-coral">Shop</Link>
          <Link href="/occasions" className="hidden sm:inline hover:text-coral">Occasions</Link>
          <Link href="/seasons" className="hidden sm:inline hover:text-coral">Seasonal</Link>
          <Link href="/shop" aria-label="Search gifts" className="hover:text-coral">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          </Link>
          {user ? (
            <Link href="/account" className="hover:text-coral">Account</Link>
          ) : (
            <Link href="/sign-in" className="hover:text-coral">Sign in</Link>
          )}
          <Link href="/cart" className="relative hover:text-coral" aria-label={`Cart, ${count} items`}>
            Cart
            {count > 0 && (
              <span className="ml-1.5 inline-grid min-w-5 h-5 place-items-center rounded-full bg-coral px-1.5 text-xs text-cream">
                {count}
              </span>
            )}
          </Link>
        </nav>
      </div>
    </header>
  );
}
