-- Supply and pricing. All internal: customers only ever see the resulting
-- product_variants.price_cents, never cost, supplier or rule.

-- ---------------------------------------------------------------------------
-- Suppliers and the items they stock
-- ---------------------------------------------------------------------------
create table internal.suppliers (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  location         text,
  contact          jsonb not null default '{}'::jsonb,
  is_confidential  boolean not null default true,
  active           boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger suppliers_updated_at before update on internal.suppliers
  for each row execute function internal.set_updated_at();
create trigger suppliers_audit after insert or update or delete on internal.suppliers
  for each row execute function internal.audit_row_change();

create type internal.supplier_item_status as enum ('available', 'unavailable', 'discontinued');

create table internal.supplier_items (
  id                uuid primary key default gen_random_uuid(),
  supplier_id       uuid not null references internal.suppliers (id) on delete restrict,
  variant_id        uuid not null references public.product_variants (id) on delete restrict,
  supplier_sku      text,
  supplier_barcode  text,
  cost_cents        public.money_cents not null,
  -- Units the supplier reports on hand. Null = not tracked (treated as unavailable).
  on_hand_qty       int check (on_hand_qty >= 0),
  status            internal.supplier_item_status not null default 'available',
  is_primary        boolean not null default true,
  aisle_location    text,                     -- for walking-order on picking lists
  last_checked_at   timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (supplier_id, variant_id)
);
create unique index supplier_items_one_primary on internal.supplier_items (variant_id) where is_primary;
create index supplier_items_variant_idx on internal.supplier_items (variant_id);
create trigger supplier_items_updated_at before update on internal.supplier_items
  for each row execute function internal.set_updated_at();
create trigger supplier_items_audit after insert or update or delete on internal.supplier_items
  for each row execute function internal.audit_row_change();

-- A supplier barcode becomes a scannable code for the variant.
create or replace function internal.sync_supplier_barcode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.supplier_barcode is not null and new.supplier_barcode <> '' then
    insert into internal.variant_barcodes (variant_id, code, kind)
    values (new.variant_id, new.supplier_barcode, 'supplier')
    on conflict (code) do nothing;
  end if;
  return new;
end;
$$;
create trigger supplier_items_barcode after insert or update of supplier_barcode on internal.supplier_items
  for each row execute function internal.sync_supplier_barcode();

-- ---------------------------------------------------------------------------
-- Pricing rules
--   markup: price = cost * (1 + rate)       10% on $20.00 -> $22.00 (true margin 9.1%)
--   margin: price = cost / (1 - rate)       10% on $20.00 -> $22.22 (true margin 10.0%)
-- The type is stored explicitly on every rule so the two can never be confused.
-- ---------------------------------------------------------------------------
create type internal.pricing_scope as enum ('global', 'category', 'product', 'variant');
create type internal.pricing_rule_type as enum ('markup', 'margin');
create type internal.price_rounding as enum ('none', 'charm_99');

create table internal.pricing_rules (
  id                uuid primary key default gen_random_uuid(),
  scope             internal.pricing_scope not null,
  category_id       uuid references public.categories (id) on delete cascade,
  product_id        uuid references public.products (id) on delete cascade,
  variant_id        uuid references public.product_variants (id) on delete cascade,
  rule_type         internal.pricing_rule_type not null,
  rate              numeric(7,4) not null check (rate >= 0),
  -- Floors. Null on a narrower rule = inherit the global rule's floor.
  min_margin        numeric(7,4) check (min_margin >= 0 and min_margin < 1),
  min_profit_cents  public.money_cents,
  rounding          internal.price_rounding,
  active            boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint margin_below_100 check (rule_type <> 'margin' or rate < 1),
  constraint scope_target check (
    (scope = 'global'   and category_id is null and product_id is null and variant_id is null) or
    (scope = 'category' and category_id is not null and product_id is null and variant_id is null) or
    (scope = 'product'  and product_id is not null and category_id is null and variant_id is null) or
    (scope = 'variant'  and variant_id is not null and category_id is null and product_id is null)
  )
);
-- At most one active rule per target.
create unique index pricing_rules_one_active on internal.pricing_rules
  (scope, coalesce(category_id, product_id, variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where active;
create trigger pricing_rules_updated_at before update on internal.pricing_rules
  for each row execute function internal.set_updated_at();
create trigger pricing_rules_audit after insert or update or delete on internal.pricing_rules
  for each row execute function internal.audit_row_change();

create table internal.price_history (
  id               bigint generated always as identity primary key,
  variant_id       uuid not null references public.product_variants (id) on delete cascade,
  old_price_cents  bigint,
  new_price_cents  bigint,
  cost_cents       bigint,
  rule_id          uuid,
  changed_by       uuid,
  changed_at       timestamptz not null default now()
);
create index price_history_variant_idx on internal.price_history (variant_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- The pricing calculation. Pure function; mirrored exactly by packages/pricing (TypeScript),
-- and a test asserts both agree.
--   1. base   = markup: cost*(1+rate)  | margin: cost/(1-rate)      (rounded to the cent)
--   2. floor  = max(ceil(cost/(1-min_margin)), cost + min_profit)
--   3. price  = max(base, floor)
--   4. rounding charm_99: smallest price ending in .99 that is >= price
-- ---------------------------------------------------------------------------
create or replace function internal.compute_price(
  p_cost_cents bigint,
  p_rule_type internal.pricing_rule_type,
  p_rate numeric,
  p_min_margin numeric default 0,
  p_min_profit_cents bigint default 0,
  p_rounding internal.price_rounding default 'none'
) returns bigint
language plpgsql
immutable
as $$
declare
  v_base  bigint;
  v_floor bigint;
  v_price bigint;
begin
  if p_cost_cents is null then
    return null;
  end if;
  if p_rule_type = 'markup' then
    v_base := round(p_cost_cents * (1 + p_rate));
  else
    if p_rate >= 1 then raise exception 'margin rate must be below 100%%'; end if;
    v_base := round(p_cost_cents / (1 - p_rate));
  end if;

  v_floor := greatest(
    ceil(p_cost_cents / (1 - coalesce(p_min_margin, 0)))::bigint,
    p_cost_cents + coalesce(p_min_profit_cents, 0)
  );
  v_price := greatest(v_base, v_floor);

  if coalesce(p_rounding, 'none') = 'charm_99' then
    v_price := (ceil((v_price + 1) / 100.0) * 100 - 1)::bigint;
  end if;
  return v_price;
end;
$$;

-- Which rule governs a variant? Most specific wins: variant > product > category
-- (nearest ancestor first) > global. Floors and rounding inherit from global when unset.
create or replace function internal.effective_pricing(p_variant_id uuid)
returns table (
  rule_id uuid, rule_type internal.pricing_rule_type, rate numeric,
  min_margin numeric, min_profit_cents bigint, rounding internal.price_rounding
)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive v as (
    select pv.id as variant_id, pv.product_id, p.category_id
    from public.product_variants pv join public.products p on p.id = pv.product_id
    where pv.id = p_variant_id
  ),
  cat_chain as (
    select c.id, c.parent_id, 0 as depth from public.categories c join v on c.id = v.category_id
    union all
    select c.id, c.parent_id, cc.depth + 1 from public.categories c join cat_chain cc on c.id = cc.parent_id
  ),
  candidates as (
    select r.*, 0 as rank from internal.pricing_rules r, v
      where r.active and r.scope = 'variant' and r.variant_id = v.variant_id
    union all
    select r.*, 1 from internal.pricing_rules r, v
      where r.active and r.scope = 'product' and r.product_id = v.product_id
    union all
    select r.*, 10 + cc.depth from internal.pricing_rules r join cat_chain cc on r.category_id = cc.id
      where r.active and r.scope = 'category'
    union all
    select r.*, 1000 from internal.pricing_rules r where r.active and r.scope = 'global'
  ),
  chosen as (select * from candidates order by rank limit 1),
  g as (select * from internal.pricing_rules where active and scope = 'global' limit 1)
  select chosen.id, chosen.rule_type, chosen.rate,
         coalesce(chosen.min_margin, g.min_margin, 0),
         coalesce(chosen.min_profit_cents, g.min_profit_cents, 0)::bigint,
         coalesce(chosen.rounding, g.rounding, 'none')
  from chosen left join g on true;
$$;

-- Recompute and store one variant's price from its primary supplier cost.
create or replace function internal.reprice_variant(p_variant_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost  bigint;
  v_rule  record;
  v_old   bigint;
  v_new   bigint;
begin
  select si.cost_cents into v_cost
  from internal.supplier_items si
  where si.variant_id = p_variant_id and si.is_primary;

  select * into v_rule from internal.effective_pricing(p_variant_id);
  if v_cost is null or v_rule.rule_id is null then
    return null;           -- no cost or no rule yet: leave price as is
  end if;

  v_new := internal.compute_price(v_cost, v_rule.rule_type, v_rule.rate,
                                  v_rule.min_margin, v_rule.min_profit_cents, v_rule.rounding);

  select price_cents into v_old from public.product_variants where id = p_variant_id for update;
  if v_old is distinct from v_new then
    update public.product_variants set price_cents = v_new where id = p_variant_id;
    insert into internal.price_history (variant_id, old_price_cents, new_price_cents, cost_cents, rule_id, changed_by)
    values (p_variant_id, v_old, v_new, v_cost, v_rule.rule_id, internal.current_actor());
  end if;
  return v_new;
end;
$$;

create or replace function internal.reprice_all()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in select id from public.product_variants loop
    perform internal.reprice_variant(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Preview a global rule change before saving: how many variants change, and by how much.
create or replace function internal.preview_global_rule(
  p_rule_type internal.pricing_rule_type, p_rate numeric
) returns table (variants_affected int, avg_old_price_cents numeric, avg_new_price_cents numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with g as (select * from internal.pricing_rules where active and scope = 'global' limit 1),
  rows as (
    select pv.id, pv.price_cents as old_price,
           internal.compute_price(si.cost_cents, p_rule_type, p_rate,
             coalesce(g.min_margin, 0), coalesce(g.min_profit_cents, 0)::bigint, coalesce(g.rounding, 'none')) as new_price
    from public.product_variants pv
    join internal.supplier_items si on si.variant_id = pv.id and si.is_primary
    left join g on true
    where (select rule_id from internal.effective_pricing(pv.id)) = g.id   -- only variants on the global rule
  )
  select count(*) filter (where old_price is distinct from new_price)::int,
         round(avg(old_price), 0), round(avg(new_price), 0)
  from rows;
$$;

-- Keep prices current: cost changes reprice that variant; rule changes reprice the catalog.
create or replace function internal.on_supplier_cost_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.reprice_variant(new.variant_id);
  return new;
end;
$$;
create trigger supplier_items_reprice after insert or update of cost_cents, is_primary on internal.supplier_items
  for each row execute function internal.on_supplier_cost_change();

create or replace function internal.on_pricing_rule_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.reprice_all();
  return null;
end;
$$;
create trigger pricing_rules_reprice after insert or update or delete on internal.pricing_rules
  for each statement execute function internal.on_pricing_rule_change();
