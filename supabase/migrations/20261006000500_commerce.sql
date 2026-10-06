-- Commerce: carts, wishlists, orders, immutable snapshots, reservations, payments, tax.
--
-- Flow:
--   customer cart  --start_checkout()-->  order (pending_payment) + 15-min reservation holds
--   Stripe webhook --mark_order_paid()--> order paid, holds confirmed, staff alert queued
--   timer          --expire_checkouts()-> unpaid orders cancelled, holds released

-- ---------------------------------------------------------------------------
-- Carts and wishlists (customer-owned; login required by RLS)
-- ---------------------------------------------------------------------------
create table public.carts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger carts_updated_at before update on public.carts
  for each row execute function internal.set_updated_at();

create table public.cart_items (
  cart_id     uuid not null references public.carts (id) on delete cascade,
  variant_id  uuid not null references public.product_variants (id) on delete cascade,
  quantity    int not null check (quantity between 1 and 10),
  added_at    timestamptz not null default now(),
  primary key (cart_id, variant_id)
);

create table public.wishlist_items (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  variant_id  uuid references public.product_variants (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, product_id)
);

alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.wishlist_items enable row level security;

create policy "carts: owner all" on public.carts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "cart items: owner read" on public.cart_items
  for select to authenticated using (
    exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()));
create policy "cart items: owner delete" on public.cart_items
  for delete to authenticated using (
    exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()));
-- Only purchasable variants can go into a cart.
create policy "cart items: owner insert purchasable" on public.cart_items
  for insert to authenticated with check (
    exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid())
    and exists (select 1 from public.product_variants v join public.products p on p.id = v.product_id
                where v.id = variant_id and v.is_active and v.price_cents is not null
                  and p.status in ('active', 'seasonal')));
create policy "cart items: owner update" on public.cart_items
  for update to authenticated
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()));

create policy "wishlist: owner all" on public.wishlist_items
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.carts, public.cart_items, public.wishlist_items from anon;

-- ---------------------------------------------------------------------------
-- Tax rules (by destination province). VERIFY WITH A CANADIAN ACCOUNTANT BEFORE LAUNCH.
-- ---------------------------------------------------------------------------
create table internal.tax_rules (
  province     char(2) primary key,
  gst_rate     numeric(6,5) not null default 0,   -- federal GST
  hst_rate     numeric(6,5) not null default 0,   -- harmonized (replaces GST + PST)
  pst_rate     numeric(6,5) not null default 0,   -- provincial (PST / QST / RST)
  tax_shipping boolean not null default true,
  effective_from date not null default current_date,
  notes        text,
  updated_at   timestamptz not null default now()
);
create trigger tax_rules_audit after insert or update or delete on internal.tax_rules
  for each row execute function internal.audit_row_change();

-- Rates as of Oct 2026 per Government of Canada / provincial sources; confirm before launch.
-- PST is often not owed until registered in that province; set pst_rate = 0 where Giftora isn't registered.
insert into internal.tax_rules (province, gst_rate, hst_rate, pst_rate, notes) values
  ('AB', 0.05, 0,    0,       'GST only'),
  ('BC', 0.05, 0,    0,       'PST 7% applies only if registered in BC'),
  ('MB', 0.05, 0,    0,       'RST 7% applies only if registered in MB'),
  ('NB', 0,    0.15, 0,       'HST'),
  ('NL', 0,    0.15, 0,       'HST'),
  ('NS', 0,    0.14, 0,       'HST (14% from 2025-04-01)'),
  ('NT', 0.05, 0,    0,       'GST only'),
  ('NU', 0.05, 0,    0,       'GST only'),
  ('ON', 0,    0.13, 0,       'HST'),
  ('PE', 0,    0.15, 0,       'HST'),
  ('QC', 0.05, 0,    0,       'QST 9.975% applies only if registered in QC'),
  ('SK', 0.05, 0,    0,       'PST 6% applies only if registered in SK'),
  ('YT', 0.05, 0,    0,       'GST only');

insert into internal.system_settings (key, value, description) values
  ('shipping.methods',
   '[{"code":"standard","name":"Standard (3–7 business days)","cents":1299,"free_over_cents":7500},
     {"code":"express","name":"Express (1–3 business days)","cents":2499,"free_over_cents":null}]',
   'Flat shipping options offered at checkout until live carrier rates are wired in'),
  ('orders.ship_within_days', '3', 'Business days promised between payment and shipment');

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create type public.order_status as enum (
  'pending_payment', 'paid', 'processing', 'ready_to_ship', 'packed',
  'shipped', 'delivered', 'cancelled', 'closed'
);
create type public.payment_status as enum (
  'pending', 'authorized', 'captured', 'failed', 'partially_refunded', 'refunded'
);
create type public.order_line_status as enum (
  'reserved', 'acquisition_pending', 'acquired', 'sorted', 'packed', 'short', 'damaged', 'cancelled'
);

create sequence public.order_number_seq start with 1001;

create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  order_number       text not null unique,
  user_id            uuid not null references public.profiles (id) on delete restrict,
  status             public.order_status not null default 'pending_payment',
  payment_status     public.payment_status not null default 'pending',
  email              extensions.citext not null,
  shipping_address   jsonb not null,      -- snapshot, not a reference: addresses can change later
  shipping_method    text not null,
  shipping_method_name text not null,
  subtotal_cents     public.money_cents not null,
  discount_cents     public.money_cents not null default 0,
  shipping_cents     public.money_cents not null,
  tax_cents          public.money_cents not null,
  total_cents        public.money_cents not null,
  currency           char(3) not null default 'CAD',
  tax_breakdown      jsonb not null default '{}'::jsonb,
  ship_by            date,
  priority           int not null default 0,
  checkout_expires_at timestamptz,
  placed_at          timestamptz not null default now(),
  paid_at            timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint totals_add_up check (total_cents = subtotal_cents - discount_cents + shipping_cents + tax_cents)
);
create index orders_user_idx on public.orders (user_id, placed_at desc);
create index orders_status_idx on public.orders (status, paid_at);
create trigger orders_updated_at before update on public.orders
  for each row execute function internal.set_updated_at();

create table public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete restrict,
  variant_id        uuid not null references public.product_variants (id) on delete restrict,
  -- Snapshot of what the customer bought, frozen at checkout.
  product_name      text not null,
  sku               text not null,
  variant_label     text not null,
  quantity          int not null check (quantity > 0),
  unit_price_cents  public.money_cents not null,
  discount_cents    public.money_cents not null default 0,
  line_total_cents  public.money_cents not null,     -- unit_price * qty - discount (pre-tax)
  status            public.order_line_status not null default 'reserved',
  sorted_qty        int not null default 0 check (sorted_qty >= 0),
  packed_qty        int not null default 0 check (packed_qty >= 0),
  created_at        timestamptz not null default now(),
  constraint sorted_not_over check (sorted_qty <= quantity),
  constraint packed_not_over check (packed_qty <= quantity)
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_variant_idx on public.order_items (variant_id);

-- Internal financial snapshot: cost and expected profit per line, frozen at checkout.
create table internal.order_financial_snapshots (
  order_item_id          uuid primary key references public.order_items (id) on delete restrict,
  order_id               uuid not null references public.orders (id) on delete restrict,
  supplier_id            uuid references internal.suppliers (id),
  supplier_item_id       uuid references internal.supplier_items (id),
  unit_cost_cents        bigint not null,
  pricing_rule_id        uuid,
  pricing_rule_type      internal.pricing_rule_type,
  pricing_rate           numeric(7,4),
  expected_profit_cents  bigint not null,       -- line_total - unit_cost * qty (before fees/shipping)
  created_at             timestamptz not null default now()
);
create index order_fin_snap_order_idx on internal.order_financial_snapshots (order_id);

-- Later money movements never edit the snapshot; they are added here.
create type internal.adjustment_kind as enum ('refund', 'shipping_cost', 'payment_fee', 'acquisition_cost_variance', 'other');
create table internal.order_adjustments (
  id             bigint generated always as identity primary key,
  order_id       uuid not null references public.orders (id) on delete restrict,
  order_item_id  uuid references public.order_items (id),
  kind           internal.adjustment_kind not null,
  -- Positive = reduces profit (a cost or a refund). Negative = increases it.
  amount_cents   bigint not null,
  note           text,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index order_adjustments_order_idx on internal.order_adjustments (order_id);

create table public.order_events (
  id                   bigint generated always as identity primary key,
  order_id             uuid not null references public.orders (id) on delete restrict,
  type                 text not null,          -- 'placed', 'paid', 'shipped', 'note', ...
  message              text,
  data                 jsonb not null default '{}'::jsonb,
  visible_to_customer  boolean not null default false,
  actor_id             uuid,
  created_at           timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, created_at);

-- Immutability: the frozen columns can never change once written.
create or replace function internal.order_items_freeze()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'order items cannot be deleted';
  end if;
  if (new.order_id, new.variant_id, new.product_name, new.sku, new.variant_label, new.quantity,
      new.unit_price_cents, new.discount_cents, new.line_total_cents)
     is distinct from
     (old.order_id, old.variant_id, old.product_name, old.sku, old.variant_label, old.quantity,
      old.unit_price_cents, old.discount_cents, old.line_total_cents) then
    raise exception 'order item snapshot is immutable (order item %)', old.id;
  end if;
  return new;
end;
$$;
create trigger order_items_freeze before update or delete on public.order_items
  for each row execute function internal.order_items_freeze();

create or replace function internal.snapshot_freeze()
returns trigger
language plpgsql
as $$
begin
  raise exception 'order financial snapshots are immutable; add an order_adjustments row instead';
end;
$$;
create trigger order_fin_snap_freeze before update or delete on internal.order_financial_snapshots
  for each row execute function internal.snapshot_freeze();
create trigger order_adjustments_freeze before update or delete on internal.order_adjustments
  for each row execute function internal.snapshot_freeze();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;

create policy "orders: owner reads" on public.orders
  for select to authenticated using (user_id = auth.uid());
create policy "order items: owner reads" on public.order_items
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));
create policy "order events: owner reads customer-visible" on public.order_events
  for select to authenticated using (
    visible_to_customer and exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));

revoke insert, update, delete, truncate on public.orders, public.order_items, public.order_events
  from anon, authenticated;
revoke all on public.orders, public.order_items, public.order_events from anon;
revoke all on sequence public.order_number_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reservations: Giftora's claim on supplier stock
-- ---------------------------------------------------------------------------
create type internal.reservation_status as enum ('held', 'confirmed', 'acquired', 'released');

create table internal.inventory_reservations (
  id                uuid primary key default gen_random_uuid(),
  variant_id        uuid not null references public.product_variants (id),
  supplier_item_id  uuid not null references internal.supplier_items (id),
  order_item_id     uuid not null unique references public.order_items (id),
  quantity          int not null check (quantity > 0),
  status            internal.reservation_status not null default 'held',
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index reservations_active_idx on internal.inventory_reservations (variant_id)
  where status in ('held', 'confirmed');
create trigger reservations_updated_at before update on internal.inventory_reservations
  for each row execute function internal.set_updated_at();

-- Units Giftora can still promise for a variant: fresh supplier stock minus active claims.
create or replace function internal.available_qty(p_variant_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  with stale as (
    select coalesce((select (value #>> '{}')::int from internal.system_settings
                     where key = 'supply.stale_after_hours'), 72) as hours
  ),
  supply as (
    select coalesce(sum(si.on_hand_qty), 0) as qty
    from internal.supplier_items si, stale
    where si.variant_id = p_variant_id
      and si.status = 'available'
      and si.last_checked_at > now() - make_interval(hours => stale.hours)
  ),
  claimed as (
    select coalesce(sum(r.quantity), 0) as qty
    from internal.inventory_reservations r
    where r.variant_id = p_variant_id and r.status in ('held', 'confirmed')
  )
  select greatest(0, supply.qty - claimed.qty)::int from supply, claimed;
$$;

-- Storefront-safe availability, capped at 10 so supplier quantity is never revealed.
create or replace function public.variant_availability(p_variant_ids uuid[])
returns table (variant_id uuid, purchasable_qty int)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, least(10, internal.available_qty(v.id))
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where v.id = any(p_variant_ids)
    and v.is_active and public.is_customer_visible(p.status);
$$;
grant execute on function public.variant_availability(uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Payments (Stripe is the source of truth; we store references, never card data)
-- ---------------------------------------------------------------------------
create table internal.payments (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete restrict,
  provider             text not null default 'stripe',
  provider_payment_id  text not null unique,         -- Stripe PaymentIntent id
  status               public.payment_status not null default 'pending',
  amount_cents         public.money_cents not null,
  fee_cents            public.money_cents,
  currency             char(3) not null default 'CAD',
  risk                 jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index payments_order_idx on internal.payments (order_id);
create trigger payments_updated_at before update on internal.payments
  for each row execute function internal.set_updated_at();

create table internal.refunds (
  id                  uuid primary key default gen_random_uuid(),
  payment_id          uuid not null references internal.payments (id),
  order_id            uuid not null references public.orders (id),
  amount_cents        public.money_cents not null check (amount_cents > 0),
  reason              text not null,
  provider_refund_id  text unique,
  status              text not null default 'pending' check (status in ('pending','succeeded','failed')),
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create trigger refunds_audit after insert or update or delete on internal.refunds
  for each row execute function internal.audit_row_change();

-- Raw webhook log. provider_event_id is unique, so a Stripe retry is a no-op.
create table internal.payment_events (
  id                 bigint generated always as identity primary key,
  provider_event_id  text not null unique,
  type               text not null,
  payload            jsonb not null,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz,
  error              text
);

-- ---------------------------------------------------------------------------
-- Checkout functions
-- ---------------------------------------------------------------------------

-- Releases a pending order's holds and cancels it.
create or replace function internal.cancel_pending_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update internal.inventory_reservations r set status = 'released'
   from public.order_items oi
   where oi.id = r.order_item_id and oi.order_id = p_order_id and r.status = 'held';
  update public.order_items set status = 'cancelled' where order_id = p_order_id;
  update public.orders set status = 'cancelled', cancelled_at = now(), checkout_expires_at = null
   where id = p_order_id and status = 'pending_payment';
  insert into public.order_events (order_id, type, message, visible_to_customer)
  values (p_order_id, 'cancelled', p_reason, false);
end;
$$;

-- Turns the signed-in customer's cart into a pending order with stock holds.
-- Fails (and changes nothing) if any line can't be covered by supplier availability.
create or replace function public.start_checkout(p_shipping_address_id uuid, p_shipping_method text)
returns table (order_id uuid, order_number text, total_cents bigint, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := auth.uid();
  v_cart      uuid;
  v_addr      public.addresses%rowtype;
  v_email     extensions.citext;
  v_method    jsonb;
  v_tax       internal.tax_rules%rowtype;
  v_hold_min  int;
  v_ship_days int;
  v_order     uuid;
  v_number    text;
  v_subtotal  bigint := 0;
  v_shipping  bigint;
  v_taxable   bigint;
  v_gst       bigint;
  v_hst       bigint;
  v_pst       bigint;
  v_expires   timestamptz;
  v_item      record;
  v_si        record;
  v_rule      record;
  v_oi        uuid;
  v_pending   uuid;
begin
  if v_user is null then
    raise exception 'login required' using errcode = '28000';
  end if;

  select id into v_cart from public.carts where user_id = v_user;
  if v_cart is null or not exists (select 1 from public.cart_items where cart_id = v_cart) then
    raise exception 'cart is empty' using errcode = 'P0001';
  end if;

  select * into v_addr from public.addresses where id = p_shipping_address_id and user_id = v_user;
  if not found then
    raise exception 'shipping address not found' using errcode = 'P0002';
  end if;
  select email into v_email from public.profiles where id = v_user;

  -- A customer has at most one pending checkout: restarting releases the old holds.
  for v_pending in select id from public.orders where user_id = v_user and status = 'pending_payment' loop
    perform internal.cancel_pending_order(v_pending, 'checkout restarted');
  end loop;

  select m into v_method
    from internal.system_settings s, jsonb_array_elements(s.value) m
   where s.key = 'shipping.methods' and m ->> 'code' = p_shipping_method;
  if v_method is null then
    raise exception 'unknown shipping method %', p_shipping_method using errcode = 'P0003';
  end if;

  select (value #>> '{}')::int into v_hold_min from internal.system_settings where key = 'checkout.reservation_minutes';
  select (value #>> '{}')::int into v_ship_days from internal.system_settings where key = 'orders.ship_within_days';
  v_expires := now() + make_interval(mins => coalesce(v_hold_min, 15));

  -- Lock the primary supplier rows in a stable order so concurrent checkouts serialize per
  -- variant without deadlocking. After this, availability reads are race-free.
  perform 1 from internal.supplier_items si
    join public.cart_items ci on ci.variant_id = si.variant_id and ci.cart_id = v_cart
   where si.is_primary
   order by si.id
   for update of si;

  v_number := coalesce((select value #>> '{}' from internal.system_settings where key = 'orders.number_prefix'), 'GFT-')
              || nextval('public.order_number_seq');

  insert into public.orders (order_number, user_id, email, shipping_address, shipping_method,
                             shipping_method_name, subtotal_cents, shipping_cents, tax_cents, total_cents,
                             checkout_expires_at, ship_by)
  values (v_number, v_user, v_email,
          jsonb_build_object('full_name', v_addr.full_name, 'line1', v_addr.line1, 'line2', v_addr.line2,
                             'city', v_addr.city, 'province', v_addr.province,
                             'postal_code', upper(v_addr.postal_code), 'country', v_addr.country,
                             'phone', v_addr.phone),
          p_shipping_method, v_method ->> 'name', 0, 0, 0, 0, v_expires,
          (current_date + make_interval(days => coalesce(v_ship_days, 3)))::date)
  returning id into v_order;

  for v_item in
    select ci.variant_id, ci.quantity, v.sku, v.label, v.price_cents, p.name as product_name, p.status
      from public.cart_items ci
      join public.product_variants v on v.id = ci.variant_id
      join public.products p on p.id = v.product_id
     where ci.cart_id = v_cart
     order by v.sku
  loop
    if v_item.status not in ('active', 'seasonal') or v_item.price_cents is null then
      raise exception '% is no longer available', v_item.sku using errcode = 'P0004';
    end if;

    select si.id, si.supplier_id, si.cost_cents into v_si
      from internal.supplier_items si where si.variant_id = v_item.variant_id and si.is_primary;
    if v_si.id is null or internal.available_qty(v_item.variant_id) < v_item.quantity then
      raise exception 'not enough stock for %', v_item.sku using errcode = 'P0005',
        detail = json_build_object('sku', v_item.sku,
                                   'available', least(10, internal.available_qty(v_item.variant_id)))::text;
    end if;

    select * into v_rule from internal.effective_pricing(v_item.variant_id);

    insert into public.order_items (order_id, variant_id, product_name, sku, variant_label, quantity,
                                    unit_price_cents, line_total_cents)
    values (v_order, v_item.variant_id, v_item.product_name, v_item.sku, v_item.label, v_item.quantity,
            v_item.price_cents, v_item.price_cents * v_item.quantity)
    returning id into v_oi;

    insert into internal.order_financial_snapshots (order_item_id, order_id, supplier_id, supplier_item_id,
           unit_cost_cents, pricing_rule_id, pricing_rule_type, pricing_rate, expected_profit_cents)
    values (v_oi, v_order, v_si.supplier_id, v_si.id, v_si.cost_cents, v_rule.rule_id, v_rule.rule_type,
            v_rule.rate, v_item.price_cents * v_item.quantity - v_si.cost_cents * v_item.quantity);

    insert into internal.inventory_reservations (variant_id, supplier_item_id, order_item_id, quantity, status, expires_at)
    values (v_item.variant_id, v_si.id, v_oi, v_item.quantity, 'held', v_expires);

    v_subtotal := v_subtotal + v_item.price_cents * v_item.quantity;
  end loop;

  v_shipping := (v_method ->> 'cents')::bigint;
  if (v_method ->> 'free_over_cents') is not null and v_subtotal >= (v_method ->> 'free_over_cents')::bigint then
    v_shipping := 0;
  end if;

  select * into v_tax from internal.tax_rules where province = v_addr.province;
  v_taxable := v_subtotal + case when coalesce(v_tax.tax_shipping, true) then v_shipping else 0 end;
  v_gst := round(v_taxable * coalesce(v_tax.gst_rate, 0));
  v_hst := round(v_taxable * coalesce(v_tax.hst_rate, 0));
  v_pst := round(v_taxable * coalesce(v_tax.pst_rate, 0));

  update public.orders
     set subtotal_cents = v_subtotal,
         shipping_cents = v_shipping,
         tax_cents = v_gst + v_hst + v_pst,
         total_cents = v_subtotal + v_shipping + v_gst + v_hst + v_pst,
         tax_breakdown = jsonb_strip_nulls(jsonb_build_object(
           'province', v_addr.province,
           'gst', nullif(v_gst, 0), 'hst', nullif(v_hst, 0), 'pst', nullif(v_pst, 0)))
   where id = v_order;

  insert into public.order_events (order_id, type, message, visible_to_customer, actor_id)
  values (v_order, 'checkout_started', 'Checkout started', false, v_user);

  return query select o.id, o.order_number, o.total_cents::bigint, o.checkout_expires_at
                 from public.orders o where o.id = v_order;
end;
$$;
grant execute on function public.start_checkout(uuid, text) to authenticated;

-- Called by the Stripe webhook handler (service role only) once payment succeeds.
create or replace function internal.mark_order_paid(
  p_order_id uuid, p_provider_payment_id text, p_amount_cents bigint, p_fee_cents bigint default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_late  boolean := false;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;
  if v_order.payment_status = 'captured' then
    return;                                  -- idempotent: webhook retried
  end if;
  if p_amount_cents <> v_order.total_cents then
    raise exception 'paid amount % does not match order total %', p_amount_cents, v_order.total_cents;
  end if;

  if v_order.status = 'cancelled' then
    -- Paid after the hold expired. Re-claim the stock and flag for staff review.
    v_late := true;
    update public.order_items set status = 'reserved' where order_id = p_order_id;
    update internal.inventory_reservations r set status = 'held'
      from public.order_items oi where oi.id = r.order_item_id and oi.order_id = p_order_id;
  end if;

  insert into internal.payments (order_id, provider_payment_id, status, amount_cents, fee_cents)
  values (p_order_id, p_provider_payment_id, 'captured', p_amount_cents, p_fee_cents)
  on conflict (provider_payment_id) do update set status = 'captured', fee_cents = excluded.fee_cents;

  if p_fee_cents is not null then
    insert into internal.order_adjustments (order_id, kind, amount_cents, note)
    values (p_order_id, 'payment_fee', p_fee_cents, 'Stripe processing fee');
  end if;

  update internal.inventory_reservations r set status = 'confirmed', expires_at = null
    from public.order_items oi where oi.id = r.order_item_id and oi.order_id = p_order_id;
  update public.order_items set status = 'acquisition_pending' where order_id = p_order_id;
  update public.orders
     set status = 'paid', payment_status = 'captured', paid_at = now(),
         checkout_expires_at = null, cancelled_at = null
   where id = p_order_id;

  delete from public.cart_items ci using public.carts c
   where c.id = ci.cart_id and c.user_id = v_order.user_id;

  insert into public.order_events (order_id, type, message, visible_to_customer)
  values (p_order_id, 'paid', 'Payment received — we''re getting your gift ready', true);

  perform internal.enqueue('order.paid', jsonb_build_object('order_id', p_order_id, 'late_payment', v_late));
  if v_late then
    perform internal.enqueue('order.paid_after_expiry', jsonb_build_object('order_id', p_order_id));
  end if;
end;
$$;

-- Releases holds on checkouts nobody paid for. Run every minute by the job runner or pg_cron.
create or replace function internal.expire_checkouts()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_n  int := 0;
begin
  for v_id in
    select id from public.orders
     where status = 'pending_payment' and checkout_expires_at < now()
     for update skip locked
  loop
    perform internal.cancel_pending_order(v_id, 'checkout expired');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Staff-alert payload. Cost and profit are included ONLY for the finance view; callers
-- choose the variant per recipient so a WhatsApp to an order manager never carries margins.
create or replace function internal.order_alert_payload(p_order_id uuid, p_include_finance boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'order_number', o.order_number,
    'customer', o.shipping_address ->> 'full_name',
    'email', o.email,
    'shipping_method', o.shipping_method_name,
    'ship_to', concat_ws(', ', o.shipping_address ->> 'city', o.shipping_address ->> 'province'),
    'payment_status', o.payment_status,
    'total_cents', o.total_cents,
    'ship_by', o.ship_by,
    'items', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                'sku', oi.sku, 'product', oi.product_name, 'variant', oi.variant_label,
                'quantity', oi.quantity, 'unit_price_cents', oi.unit_price_cents,
                'unit_cost_cents', case when p_include_finance then s.unit_cost_cents end,
                'expected_profit_cents', case when p_include_finance then s.expected_profit_cents end))
                order by oi.sku)
              from public.order_items oi
              left join internal.order_financial_snapshots s on s.order_item_id = oi.id
              where oi.order_id = o.id),
    'expected_profit_cents', case when p_include_finance then
       (select sum(expected_profit_cents) from internal.order_financial_snapshots where order_id = o.id) end,
    'action_required', 'Acquire items from supplier'
  ))
  from public.orders o where o.id = p_order_id;
$$;
