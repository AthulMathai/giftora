-- Hardening from the Supabase security and performance advisors.

-- ---------------------------------------------------------------------------
-- 1. Signed-out visitors may not call login-only functions.
--    (variant_availability stays public on purpose: the store shows stock to everyone.)
-- ---------------------------------------------------------------------------
revoke execute on function public.start_checkout(uuid, text) from public, anon;
revoke execute on function public.my_staff_permissions() from public, anon;
grant execute on function public.start_checkout(uuid, text) to authenticated;
grant execute on function public.my_staff_permissions() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Evaluate auth.uid() once per query, not once per row.
-- ---------------------------------------------------------------------------
alter policy "profiles: owner reads" on public.profiles
  using (id = (select auth.uid()));
alter policy "profiles: owner updates" on public.profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy "addresses: owner all" on public.addresses
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "carts: owner all" on public.carts
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "cart items: owner read" on public.cart_items
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())));
alter policy "cart items: owner delete" on public.cart_items
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())));
alter policy "cart items: owner insert purchasable" on public.cart_items
  with check (
    exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid()))
    and exists (select 1 from public.product_variants v join public.products p on p.id = v.product_id
                where v.id = variant_id and v.is_active and v.price_cents is not null
                  and p.status in ('active', 'seasonal')));
alter policy "cart items: owner update" on public.cart_items
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())));
alter policy "wishlist: owner all" on public.wishlist_items
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "orders: owner reads" on public.orders
  using (user_id = (select auth.uid()));
alter policy "order items: owner reads" on public.order_items
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));
alter policy "order events: owner reads customer-visible" on public.order_events
  using (visible_to_customer and exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- 3. Index every foreign key (fast joins and fast deletes of parents).
-- ---------------------------------------------------------------------------
create index if not exists inventory_reservations_supplier_item_idx on internal.inventory_reservations (supplier_item_id);
create index if not exists order_adjustments_order_item_idx on internal.order_adjustments (order_item_id);
create index if not exists order_fin_snap_supplier_idx on internal.order_financial_snapshots (supplier_id);
create index if not exists order_fin_snap_supplier_item_idx on internal.order_financial_snapshots (supplier_item_id);
create index if not exists pricing_rules_category_idx on internal.pricing_rules (category_id);
create index if not exists pricing_rules_product_idx on internal.pricing_rules (product_id);
create index if not exists pricing_rules_variant_idx on internal.pricing_rules (variant_id);
create index if not exists refunds_order_idx on internal.refunds (order_id);
create index if not exists refunds_payment_idx on internal.refunds (payment_id);
create index if not exists role_permissions_permission_idx on internal.role_permissions (permission_key);
create index if not exists staff_members_role_idx on internal.staff_members (role_key);
create index if not exists cart_items_variant_idx on public.cart_items (variant_id);
create index if not exists categories_parent_idx on public.categories (parent_id);
create index if not exists collection_products_product_idx on public.collection_products (product_id);
create index if not exists product_images_variant_idx on public.product_images (variant_id);
create index if not exists wishlist_items_product_idx on public.wishlist_items (product_id);
create index if not exists wishlist_items_variant_idx on public.wishlist_items (variant_id);
