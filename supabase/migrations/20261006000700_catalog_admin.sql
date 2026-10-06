-- Catalog administration for the staff app: products, variants with supplier cost and stock,
-- photos, categories, stock checks and pricing rules. All through permission-checked,
-- audited svc_* functions callable only by service_role.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function internal.text_array(p jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(select btrim(x) from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) x
                        where btrim(x) <> ''), '{}');
$$;

-- The supplier new variants are bought from. Creates "Primary Supplier" on first use.
create or replace function internal.default_supplier()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  select id into v from internal.suppliers where active order by created_at limit 1;
  if v is null then
    insert into internal.suppliers (name, notes) values ('Primary Supplier', 'Created automatically')
    returning id into v;
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
create or replace function public.svc_catalog_products(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'catalog.view');
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.updated_at desc)
    from (
      select p.id, p.slug, p.name, p.status, p.updated_at,
             c.name as category,
             (select count(*) from public.product_variants v where v.product_id = p.id and v.is_active) as variants,
             (select min(price_cents) from public.product_variants v where v.product_id = p.id and v.is_active) as min_price_cents,
             (select max(price_cents) from public.product_variants v where v.product_id = p.id and v.is_active) as max_price_cents,
             (select coalesce(sum(internal.available_qty(v.id)), 0) from public.product_variants v
               where v.product_id = p.id and v.is_active) as available,
             (select i.url from public.product_images i where i.product_id = p.id order by i.sort_order limit 1) as image_url
      from public.products p
      left join public.categories c on c.id = p.category_id
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.svc_product_get(p_actor uuid, p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finance  boolean;
  v_supplier boolean;
begin
  perform internal.act_as(p_actor, 'catalog.view');
  v_finance := internal.has_permission(p_actor, 'finance.view');
  v_supplier := internal.has_permission(p_actor, 'suppliers.view');
  return (
    select jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'name', p.name, 'description', p.description,
      'category_id', p.category_id, 'status', p.status, 'tags', p.tags, 'occasions', p.occasions,
      'recipients', p.recipients, 'option_names', p.option_names,
      'seo_title', p.seo_title, 'seo_description', p.seo_description, 'published_at', p.published_at,
      'images', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt_text', i.alt_text,
                                                              'sort_order', i.sort_order) order by i.sort_order)
                          from public.product_images i where i.product_id = p.id), '[]'::jsonb),
      'variants', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', v.id, 'sku', v.sku, 'label', v.label, 'options', v.options,
          'price_cents', v.price_cents, 'compare_at_cents', v.compare_at_cents,
          'weight_grams', v.weight_grams, 'is_active', v.is_active, 'sort_order', v.sort_order,
          'available', internal.available_qty(v.id),
          'supplier_sku', case when v_supplier then si.supplier_sku end,
          'supplier_barcode', case when v_supplier then si.supplier_barcode end,
          'on_hand_qty', case when v_supplier then si.on_hand_qty end,
          'supply_status', case when v_supplier then si.status end,
          'aisle_location', case when v_supplier then si.aisle_location end,
          'last_checked_at', case when v_supplier then si.last_checked_at end,
          'cost_cents', case when v_finance then si.cost_cents end,
          'rule', case when v_finance then (
             select jsonb_build_object('rule_type', e.rule_type, 'rate', e.rate, 'min_margin', e.min_margin,
                                       'min_profit_cents', e.min_profit_cents, 'rounding', e.rounding,
                                       'scope', r.scope)
             from internal.effective_pricing(v.id) e
             left join internal.pricing_rules r on r.id = e.rule_id) end
        )) order by v.sort_order, v.sku)
        from public.product_variants v
        left join internal.supplier_items si on si.variant_id = v.id and si.is_primary
        where v.product_id = p.id), '[]'::jsonb)
    )
    from public.products p where p.id = p_product_id
  );
end;
$$;

create or replace function public.svc_product_save(p_actor uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid := nullif(p ->> 'id', '')::uuid;
  v_old    jsonb;
  v_status public.product_status := coalesce(nullif(p ->> 'status', ''), 'draft')::public.product_status;
begin
  perform internal.act_as(p_actor, 'catalog.edit');
  if coalesce(btrim(p ->> 'name'), '') = '' then
    raise exception 'Product name is required' using errcode = 'P0020';
  end if;

  if v_id is null then
    insert into public.products (slug, name, description, category_id, status, tags, occasions, recipients,
                                 option_names, seo_title, seo_description, published_at)
    values (lower(btrim(p ->> 'slug')), btrim(p ->> 'name'), nullif(btrim(p ->> 'description'), ''),
            nullif(p ->> 'category_id', '')::uuid, v_status,
            internal.text_array(p -> 'tags'), internal.text_array(p -> 'occasions'),
            internal.text_array(p -> 'recipients'), internal.text_array(p -> 'option_names'),
            nullif(btrim(p ->> 'seo_title'), ''), nullif(btrim(p ->> 'seo_description'), ''),
            case when v_status in ('active', 'seasonal') then now() end)
    returning id into v_id;
    perform internal.write_audit('product.create', 'public.products', v_id::text, null, p);
  else
    select to_jsonb(x) into v_old from public.products x where x.id = v_id for update;
    if v_old is null then raise exception 'Product not found'; end if;
    update public.products set
      slug = lower(btrim(p ->> 'slug')),
      name = btrim(p ->> 'name'),
      description = nullif(btrim(p ->> 'description'), ''),
      category_id = nullif(p ->> 'category_id', '')::uuid,
      status = v_status,
      tags = internal.text_array(p -> 'tags'),
      occasions = internal.text_array(p -> 'occasions'),
      recipients = internal.text_array(p -> 'recipients'),
      option_names = internal.text_array(p -> 'option_names'),
      seo_title = nullif(btrim(p ->> 'seo_title'), ''),
      seo_description = nullif(btrim(p ->> 'seo_description'), ''),
      published_at = coalesce(published_at, case when v_status in ('active', 'seasonal') then now() end)
    where id = v_id;
    perform internal.write_audit('product.update', 'public.products', v_id::text, v_old,
                                 (select to_jsonb(x) from public.products x where x.id = v_id));
  end if;
  return v_id;
end;
$$;

-- Saves a variant and (with suppliers.edit) its primary supplier item: cost, stock, barcode, aisle.
-- Saving supplier fields counts as a fresh stock check. The price is recomputed automatically.
create or replace function public.svc_variant_save(p_actor uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid := nullif(p ->> 'id', '')::uuid;
  v_product  uuid := nullif(p ->> 'product_id', '')::uuid;
  v_supplier uuid;
begin
  perform internal.act_as(p_actor, 'catalog.edit');
  if coalesce(btrim(p ->> 'sku'), '') = '' then
    raise exception 'SKU is required' using errcode = 'P0021';
  end if;

  if v_id is null then
    insert into public.product_variants (product_id, sku, label, options, compare_at_cents, weight_grams, is_active, sort_order)
    values (v_product, upper(btrim(p ->> 'sku')), coalesce(nullif(btrim(p ->> 'label'), ''), 'Default'),
            coalesce(p -> 'options', '{}'::jsonb), nullif(p ->> 'compare_at_cents', '')::bigint,
            nullif(p ->> 'weight_grams', '')::int, coalesce((p ->> 'is_active')::boolean, true),
            coalesce((p ->> 'sort_order')::int,
                     (select coalesce(max(sort_order), 0) + 1 from public.product_variants where product_id = v_product)))
    returning id into v_id;
  else
    update public.product_variants set
      sku = upper(btrim(p ->> 'sku')),
      label = coalesce(nullif(btrim(p ->> 'label'), ''), 'Default'),
      options = coalesce(p -> 'options', options),
      compare_at_cents = nullif(p ->> 'compare_at_cents', '')::bigint,
      weight_grams = nullif(p ->> 'weight_grams', '')::int,
      is_active = coalesce((p ->> 'is_active')::boolean, is_active),
      sort_order = coalesce((p ->> 'sort_order')::int, sort_order)
    where id = v_id;
    if not found then raise exception 'Variant not found'; end if;
  end if;

  if p ? 'cost_cents' and nullif(p ->> 'cost_cents', '') is not null then
    perform internal.act_as(p_actor, 'suppliers.edit');
    v_supplier := coalesce(nullif(p ->> 'supplier_id', '')::uuid,
                           (select supplier_id from internal.supplier_items where variant_id = v_id and is_primary),
                           internal.default_supplier());
    insert into internal.supplier_items (supplier_id, variant_id, supplier_sku, supplier_barcode, cost_cents,
                                         on_hand_qty, status, aisle_location, is_primary, last_checked_at)
    values (v_supplier, v_id, nullif(btrim(p ->> 'supplier_sku'), ''), nullif(btrim(p ->> 'supplier_barcode'), ''),
            (p ->> 'cost_cents')::bigint, nullif(p ->> 'on_hand_qty', '')::int,
            coalesce(nullif(p ->> 'supply_status', ''), 'available')::internal.supplier_item_status,
            nullif(btrim(p ->> 'aisle_location'), ''), true, now())
    on conflict (supplier_id, variant_id) do update set
      supplier_sku = excluded.supplier_sku,
      supplier_barcode = excluded.supplier_barcode,
      cost_cents = excluded.cost_cents,
      on_hand_qty = excluded.on_hand_qty,
      status = excluded.status,
      aisle_location = excluded.aisle_location,
      is_primary = true,
      last_checked_at = now();
  end if;
  return v_id;
end;
$$;

create or replace function public.svc_image_add(p_actor uuid, p_product_id uuid, p_url text, p_alt text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v uuid;
begin
  perform internal.act_as(p_actor, 'catalog.edit');
  insert into public.product_images (product_id, url, alt_text, sort_order)
  values (p_product_id, p_url, coalesce(nullif(btrim(p_alt), ''), (select name from public.products where id = p_product_id)),
          (select coalesce(max(sort_order), -1) + 1 from public.product_images where product_id = p_product_id))
  returning id into v;
  return v;
end;
$$;

-- Returns the deleted image's URL so the caller can remove the file from storage.
create or replace function public.svc_image_delete(p_actor uuid, p_image_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v text;
begin
  perform internal.act_as(p_actor, 'catalog.edit');
  delete from public.product_images where id = p_image_id returning url into v;
  return v;
end;
$$;

create or replace function public.svc_image_make_first(p_actor uuid, p_image_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'catalog.edit');
  update public.product_images i
     set sort_order = case when i.id = p_image_id then -1 else i.sort_order end
   where i.product_id = (select product_id from public.product_images where id = p_image_id);
  -- renumber 0..n
  update public.product_images i set sort_order = r.n
    from (select id, row_number() over (order by sort_order, created_at) - 1 as n
            from public.product_images
           where product_id = (select product_id from public.product_images where id = p_image_id)) r
   where r.id = i.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Categories and suppliers
-- ---------------------------------------------------------------------------
create or replace function public.svc_categories(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'catalog.view');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'description', c.description,
                                        'parent_id', c.parent_id, 'sort_order', c.sort_order, 'is_visible', c.is_visible,
                                        'products', (select count(*) from public.products p where p.category_id = c.id))
                     order by c.sort_order, c.name)
    from public.categories c), '[]'::jsonb);
end;
$$;

create or replace function public.svc_category_save(p_actor uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform internal.act_as(p_actor, 'catalog.edit');
  if v is null then
    insert into public.categories (slug, name, description, parent_id, sort_order, is_visible)
    values (lower(btrim(p ->> 'slug')), btrim(p ->> 'name'), nullif(btrim(p ->> 'description'), ''),
            nullif(p ->> 'parent_id', '')::uuid, coalesce((p ->> 'sort_order')::int, 0),
            coalesce((p ->> 'is_visible')::boolean, true))
    returning id into v;
  else
    update public.categories set slug = lower(btrim(p ->> 'slug')), name = btrim(p ->> 'name'),
           description = nullif(btrim(p ->> 'description'), ''), parent_id = nullif(p ->> 'parent_id', '')::uuid,
           sort_order = coalesce((p ->> 'sort_order')::int, sort_order),
           is_visible = coalesce((p ->> 'is_visible')::boolean, is_visible)
     where id = v;
  end if;
  perform internal.write_audit('category.save', 'public.categories', v::text, null, p);
  return v;
end;
$$;

create or replace function public.svc_suppliers(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'suppliers.view');
  perform internal.default_supplier();
  return (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'location', location, 'active', active)
                           order by created_at) from internal.suppliers);
end;
$$;

-- ---------------------------------------------------------------------------
-- Stock checks: confirm what the supplier has after each visit
-- ---------------------------------------------------------------------------
create or replace function public.svc_stock_list(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_hours int;
begin
  perform internal.act_as(p_actor, 'suppliers.view');
  select coalesce((value #>> '{}')::int, 72) into v_hours from internal.system_settings where key = 'supply.stale_after_hours';
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.aisle_location nulls last, x.sku)
    from (
      select v.id as variant_id, v.sku, v.label, p.name as product, p.status as product_status,
             sup.name as supplier, si.aisle_location, si.on_hand_qty, si.status as supply_status, si.last_checked_at,
             (si.last_checked_at is null or si.last_checked_at < now() - make_interval(hours => coalesce(v_hours, 72))) as stale,
             (select coalesce(sum(r.quantity), 0) from internal.inventory_reservations r
               where r.variant_id = v.id and (r.status = 'confirmed'
                 or (r.status = 'held' and (r.expires_at is null or r.expires_at > now())))) as reserved,
             internal.available_qty(v.id) as available
      from public.product_variants v
      join public.products p on p.id = v.product_id
      left join internal.supplier_items si on si.variant_id = v.id and si.is_primary
      left join internal.suppliers sup on sup.id = si.supplier_id
      where v.is_active and p.status not in ('archived', 'discontinued')
    ) x
  ), '[]'::jsonb);
end;
$$;

-- rows: [{"variant_id": "...", "on_hand_qty": 4, "supply_status": "available"}, ...]
create or replace function public.svc_stock_update(p_actor uuid, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  n int := 0;
begin
  perform internal.act_as(p_actor, 'suppliers.edit');
  for r in select * from jsonb_array_elements(p_rows) loop
    update internal.supplier_items
       set on_hand_qty = nullif(r ->> 'on_hand_qty', '')::int,
           status = coalesce(nullif(r ->> 'supply_status', ''), status::text)::internal.supplier_item_status,
           last_checked_at = now()
     where variant_id = (r ->> 'variant_id')::uuid and is_primary;
    n := n + (case when found then 1 else 0 end);
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pricing rules
-- ---------------------------------------------------------------------------
create or replace function public.svc_pricing_rules(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'finance.view');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'scope', r.scope, 'rule_type', r.rule_type, 'rate', r.rate,
      'min_margin', r.min_margin, 'min_profit_cents', r.min_profit_cents, 'rounding', r.rounding,
      'notes', r.notes, 'updated_at', r.updated_at,
      'target_id', coalesce(r.category_id, r.product_id, r.variant_id),
      'target_name', coalesce(c.name, p.name, v.sku))
      order by case r.scope when 'global' then 0 when 'category' then 1 when 'product' then 2 else 3 end,
               coalesce(c.name, p.name, v.sku))
    from internal.pricing_rules r
    left join public.categories c on c.id = r.category_id
    left join public.products p on p.id = r.product_id
    left join public.product_variants v on v.id = r.variant_id
    where r.active), '[]'::jsonb);
end;
$$;

-- Creates or replaces the active rule for a target. p.reason is stored in the audit log.
create or replace function public.svc_pricing_rule_save(p_actor uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope  internal.pricing_scope := (p ->> 'scope')::internal.pricing_scope;
  v_target uuid := nullif(p ->> 'target_id', '')::uuid;
  v_id     uuid;
begin
  perform internal.act_as(p_actor, 'pricing.edit');
  perform set_config('giftora.reason', coalesce(p ->> 'reason', ''), true);
  if v_scope <> 'global' and v_target is null then
    raise exception 'Choose what this rule applies to' using errcode = 'P0022';
  end if;

  update internal.pricing_rules set active = false
   where active and scope = v_scope
     and coalesce(category_id, product_id, variant_id) is not distinct from (case when v_scope = 'global' then null else v_target end);

  insert into internal.pricing_rules (scope, category_id, product_id, variant_id, rule_type, rate,
                                      min_margin, min_profit_cents, rounding, notes)
  values (v_scope,
          case when v_scope = 'category' then v_target end,
          case when v_scope = 'product' then v_target end,
          case when v_scope = 'variant' then v_target end,
          (p ->> 'rule_type')::internal.pricing_rule_type, (p ->> 'rate')::numeric,
          nullif(p ->> 'min_margin', '')::numeric, nullif(p ->> 'min_profit_cents', '')::bigint,
          nullif(p ->> 'rounding', '')::internal.price_rounding, nullif(btrim(p ->> 'notes'), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.svc_pricing_rule_remove(p_actor uuid, p_rule_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'pricing.edit');
  perform set_config('giftora.reason', coalesce(p_reason, ''), true);
  if (select scope from internal.pricing_rules where id = p_rule_id) = 'global' then
    raise exception 'The global rule can be changed but not removed' using errcode = 'P0023';
  end if;
  update internal.pricing_rules set active = false where id = p_rule_id;
end;
$$;

create or replace function public.svc_pricing_preview(p_actor uuid, p_rule_type text, p_rate numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'finance.view');
  return (select to_jsonb(x) from internal.preview_global_rule(p_rule_type::internal.pricing_rule_type, p_rate) x);
end;
$$;

-- ---------------------------------------------------------------------------
-- Product photo storage (public read; writes only from the staff server)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('product-images', 'product-images', true, 5242880,
            array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
    on conflict (id) do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Lock down every new svc_ function to service_role.
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'svc\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
