-- Bulk product import from the supplier's Excel sheet, and bulk photo upload by item number.
--
-- The staff app reads the sheet in the browser, maps its columns, and sends normalized rows:
--   { row, item_number, name, description, category, cost_cents, on_hand_qty, aisle_location,
--     barcode, inner_qty, inner_barcode, outer_qty, outer_barcode, group, options {Size: "M"},
--     occasions[], recipients[], tags[], seo_title, seo_description, title }
-- Matching is by item number (= variant SKU). Re-uploading a sheet only adds new items and
-- updates existing ones; nothing is ever deleted. Blank cells never wipe existing values.
-- By default an update only touches supplier fields (cost, stock, location, barcodes, packs);
-- product names/descriptions are customer-facing and change only when staff tick that option.

alter table public.product_images add column source_name text;
create index product_images_source_idx on public.product_images (product_id, source_name);

-- Item numbers from a supplier may contain spaces, dots or slashes; SKUs may not.
create or replace function internal.normalize_sku(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(btrim(regexp_replace(upper(btrim(coalesce(p, ''))), '[^A-Z0-9]+', '-', 'g'), '-'), 40), '')
$$;

create or replace function internal.slugify(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(left(btrim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'), '-'), 60), ''), 'item')
$$;

create or replace function internal.unique_product_slug(p_name text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_base text := internal.slugify(p_name);
  v_slug text := v_base;
  n int := 1;
begin
  while exists (select 1 from public.products where slug = v_slug) loop
    n := n + 1;
    v_slug := v_base || '-' || n;
  end loop;
  return v_slug;
end;
$$;

create or replace function internal.find_category(p_name text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select id from public.categories
   where lower(name) = lower(btrim(p_name)) or slug = internal.slugify(p_name)
   order by (lower(name) = lower(btrim(p_name))) desc
   limit 1
$$;

create or replace function internal.import_num(p jsonb, k text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p -> k) = 'number' then round((p ->> k)::numeric)::bigint
              when (p ->> k) ~ '^\s*-?\d+(\.\d+)?\s*$' then round((p ->> k)::numeric)::bigint end
$$;

-- What one row would do, without changing anything. Shared by preview and apply.
create or replace function internal.import_plan(p_row jsonb, p_update_content boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sku     text := internal.normalize_sku(p_row ->> 'item_number');
  v_variant public.product_variants%rowtype;
  v_product public.products%rowtype;
  v_si      internal.supplier_items%rowtype;
  v_changes jsonb := '[]'::jsonb;
  v_msgs    jsonb := '[]'::jsonb;
  v_cat     text := nullif(btrim(p_row ->> 'category'), '');
  v_cat_name text;
begin
  if v_sku is null then
    return jsonb_build_object('action', 'error', 'messages', jsonb_build_array('No item number'));
  end if;

  select * into v_variant from public.product_variants
   where sku = v_sku
      or id = (select variant_id from internal.supplier_items where supplier_sku = btrim(p_row ->> 'item_number') and is_primary limit 1)
   limit 1;

  if v_cat is not null and internal.find_category(v_cat) is null then
    v_msgs := v_msgs || to_jsonb(format('New category "%s" will be created', v_cat));
  end if;

  if v_variant.id is null then
    if coalesce(btrim(coalesce(p_row ->> 'title', p_row ->> 'name')), '') = '' then
      return jsonb_build_object('sku', v_sku, 'action', 'error', 'messages', jsonb_build_array('New item has no name'));
    end if;
    if internal.import_num(p_row, 'cost_cents') is null then
      v_msgs := v_msgs || to_jsonb('No cost yet: it will be saved but not for sale until a cost is added'::text);
    end if;
    return jsonb_build_object('sku', v_sku, 'action', 'new',
                              'name', coalesce(nullif(btrim(p_row ->> 'title'), ''), btrim(p_row ->> 'name')),
                              'messages', v_msgs);
  end if;

  select * into v_product from public.products where id = v_variant.product_id;
  select * into v_si from internal.supplier_items where variant_id = v_variant.id and is_primary;

  -- Supplier fields: only cells that have a value.
  if internal.import_num(p_row, 'cost_cents') is not null and internal.import_num(p_row, 'cost_cents') is distinct from v_si.cost_cents then
    v_changes := v_changes || jsonb_build_object('field', 'cost', 'from', v_si.cost_cents, 'to', internal.import_num(p_row, 'cost_cents'));
  end if;
  if internal.import_num(p_row, 'on_hand_qty') is not null and internal.import_num(p_row, 'on_hand_qty') is distinct from v_si.on_hand_qty then
    v_changes := v_changes || jsonb_build_object('field', 'stock', 'from', v_si.on_hand_qty, 'to', internal.import_num(p_row, 'on_hand_qty'));
  end if;
  if nullif(btrim(p_row ->> 'aisle_location'), '') is not null and btrim(p_row ->> 'aisle_location') is distinct from v_si.aisle_location then
    v_changes := v_changes || jsonb_build_object('field', 'location', 'from', v_si.aisle_location, 'to', btrim(p_row ->> 'aisle_location'));
  end if;
  if nullif(btrim(p_row ->> 'barcode'), '') is not null and btrim(p_row ->> 'barcode') is distinct from v_si.supplier_barcode then
    v_changes := v_changes || jsonb_build_object('field', 'barcode', 'from', v_si.supplier_barcode, 'to', btrim(p_row ->> 'barcode'));
  end if;
  if internal.import_num(p_row, 'inner_qty') is not null and internal.import_num(p_row, 'inner_qty') is distinct from v_si.inner_qty::bigint then
    v_changes := v_changes || jsonb_build_object('field', 'inner qty', 'from', v_si.inner_qty, 'to', internal.import_num(p_row, 'inner_qty'));
  end if;
  if internal.import_num(p_row, 'outer_qty') is not null and internal.import_num(p_row, 'outer_qty') is distinct from v_si.outer_qty::bigint then
    v_changes := v_changes || jsonb_build_object('field', 'outer qty', 'from', v_si.outer_qty, 'to', internal.import_num(p_row, 'outer_qty'));
  end if;

  if p_update_content then
    if nullif(btrim(coalesce(p_row ->> 'title', p_row ->> 'name')), '') is not null
       and btrim(coalesce(p_row ->> 'title', p_row ->> 'name')) is distinct from v_product.name then
      v_changes := v_changes || jsonb_build_object('field', 'name', 'from', v_product.name, 'to', btrim(coalesce(p_row ->> 'title', p_row ->> 'name')));
    end if;
    if nullif(btrim(p_row ->> 'description'), '') is not null and btrim(p_row ->> 'description') is distinct from v_product.description then
      v_changes := v_changes || jsonb_build_object('field', 'description', 'from', left(v_product.description, 60), 'to', left(btrim(p_row ->> 'description'), 60));
    end if;
    if v_cat is not null then
      select name into v_cat_name from public.categories where id = v_product.category_id;
      if v_cat_name is distinct from v_cat and coalesce(internal.find_category(v_cat), '00000000-0000-0000-0000-000000000000'::uuid) is distinct from v_product.category_id then
        v_changes := v_changes || jsonb_build_object('field', 'category', 'from', v_cat_name, 'to', v_cat);
      end if;
    end if;
  end if;

  return jsonb_build_object('sku', v_sku, 'action', case when jsonb_array_length(v_changes) > 0 then 'update' else 'same' end,
                            'name', v_product.name, 'product_id', v_product.id, 'variant_id', v_variant.id,
                            'changes', v_changes, 'messages', v_msgs);
end;
$$;

create or replace function public.svc_import_preview(p_actor uuid, p_rows jsonb, p_update_content boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      jsonb;
  v_plan jsonb;
  v_seen jsonb := '{}'::jsonb;
  v_sku  text;
  v_out  jsonb := '[]'::jsonb;
begin
  perform internal.act_as(p_actor, 'catalog.edit');
  perform internal.act_as(p_actor, 'suppliers.edit');
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Send up to 5,000 rows at a time' using errcode = 'P0040';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_sku := internal.normalize_sku(r ->> 'item_number');
    if v_sku is not null and v_seen ? v_sku then
      v_plan := jsonb_build_object('sku', v_sku, 'action', 'error',
                  'messages', jsonb_build_array(format('Duplicate: item number already on row %s of this file', v_seen ->> v_sku)));
    else
      v_plan := internal.import_plan(r, p_update_content);
      if v_sku is not null then v_seen := v_seen || jsonb_build_object(v_sku, r ->> 'row'); end if;
    end if;
    v_out := v_out || (jsonb_build_object('row', r -> 'row') || v_plan);
  end loop;
  return jsonb_build_object(
    'rows', v_out,
    'summary', jsonb_build_object(
      'new', (select count(*) from jsonb_array_elements(v_out) x where x ->> 'action' = 'new'),
      'update', (select count(*) from jsonb_array_elements(v_out) x where x ->> 'action' = 'update'),
      'same', (select count(*) from jsonb_array_elements(v_out) x where x ->> 'action' = 'same'),
      'error', (select count(*) from jsonb_array_elements(v_out) x where x ->> 'action' = 'error')));
end;
$$;

-- Applies the rows. Each row succeeds or fails on its own; one bad row never blocks the rest.
create or replace function public.svc_import_apply(
  p_actor uuid, p_rows jsonb, p_update_content boolean default false, p_publish boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          jsonb;
  v_plan     jsonb;
  v_sku      text;
  v_seen     jsonb := '{}'::jsonb;
  v_groups   jsonb := '{}'::jsonb;   -- group key -> product id (rows grouped into one product)
  v_product  uuid;
  v_variant  uuid;
  v_cat      uuid;
  v_name     text;
  v_group    text;
  v_supplier uuid := internal.default_supplier();
  v_opts     jsonb;
  v_label    text;
  v_created_p int := 0; v_created_v int := 0; v_updated int := 0; v_same int := 0;
  v_errors   jsonb := '[]'::jsonb;
  v_status   public.product_status := case when p_publish then 'active' else 'draft' end;
begin
  perform internal.act_as(p_actor, 'catalog.edit');
  perform internal.act_as(p_actor, 'suppliers.edit');
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'Send up to 500 rows per batch' using errcode = 'P0040';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_sku := internal.normalize_sku(r ->> 'item_number');
    begin
      if v_sku is not null and v_seen ? v_sku then
        raise exception 'Duplicate item number in this file (row %)', v_seen ->> v_sku;
      end if;
      v_plan := internal.import_plan(r, p_update_content);
      if v_plan ->> 'action' = 'error' then
        raise exception '%', v_plan -> 'messages' ->> 0;
      end if;
      v_seen := v_seen || jsonb_build_object(v_sku, r ->> 'row');

      -- Category (created on demand).
      v_cat := null;
      if nullif(btrim(r ->> 'category'), '') is not null then
        v_cat := internal.find_category(r ->> 'category');
        if v_cat is null then
          insert into public.categories (slug, name) values (internal.slugify(r ->> 'category'), btrim(r ->> 'category'))
          on conflict (slug) do update set name = public.categories.name
          returning id into v_cat;
        end if;
      end if;

      v_opts := case when jsonb_typeof(r -> 'options') = 'object' then jsonb_strip_nulls(r -> 'options') else '{}'::jsonb end;
      v_label := coalesce(nullif((select string_agg(value, ' / ' order by key) from jsonb_each_text(v_opts) where btrim(value) <> ''), ''), 'Default');

      if v_plan ->> 'action' = 'new' then
        v_name := coalesce(nullif(btrim(r ->> 'title'), ''), btrim(r ->> 'name'));
        v_group := nullif(lower(btrim(r ->> 'group')), '');
        v_product := case when v_group is not null then (v_groups ->> v_group)::uuid end;
        if v_product is null and v_group is not null then
          -- A later sheet may add a new size to a product created earlier from the same group.
          select v.product_id into v_product from public.product_variants v
            join internal.supplier_items si on si.variant_id = v.id and si.is_primary
           where si.notes = 'import-group:' || v_group limit 1;
        end if;
        if v_product is null then
          insert into public.products (slug, name, description, category_id, status, tags, occasions, recipients,
                                       option_names, seo_title, seo_description, published_at)
          values (internal.unique_product_slug(v_name), v_name, nullif(btrim(r ->> 'description'), ''), v_cat, v_status,
                  internal.text_array(r -> 'tags'), internal.text_array(r -> 'occasions'), internal.text_array(r -> 'recipients'),
                  coalesce((select array_agg(key order by key) from jsonb_object_keys(v_opts) key), '{}'),
                  nullif(btrim(r ->> 'seo_title'), ''), nullif(btrim(r ->> 'seo_description'), ''),
                  case when p_publish then now() end)
          returning id into v_product;
          v_created_p := v_created_p + 1;
          if v_group is not null then v_groups := v_groups || jsonb_build_object(v_group, v_product); end if;
        end if;

        insert into public.product_variants (product_id, sku, label, options, sort_order)
        values (v_product, v_sku, v_label, v_opts,
                (select coalesce(max(sort_order), 0) + 1 from public.product_variants where product_id = v_product))
        returning id into v_variant;
        v_created_v := v_created_v + 1;

        if internal.import_num(r, 'cost_cents') is not null then
          insert into internal.supplier_items (supplier_id, variant_id, supplier_sku, supplier_barcode, cost_cents,
                                               on_hand_qty, aisle_location, is_primary, last_checked_at,
                                               inner_qty, inner_barcode, outer_qty, outer_barcode, notes)
          values (v_supplier, v_variant, btrim(r ->> 'item_number'), nullif(btrim(r ->> 'barcode'), ''),
                  internal.import_num(r, 'cost_cents'), internal.import_num(r, 'on_hand_qty')::int,
                  nullif(btrim(r ->> 'aisle_location'), ''), true, now(),
                  internal.import_num(r, 'inner_qty')::int, nullif(btrim(r ->> 'inner_barcode'), ''),
                  internal.import_num(r, 'outer_qty')::int, nullif(btrim(r ->> 'outer_barcode'), ''),
                  case when v_group is not null then 'import-group:' || v_group end);
        end if;

      elsif v_plan ->> 'action' = 'update' then
        v_variant := (v_plan ->> 'variant_id')::uuid;
        v_product := (v_plan ->> 'product_id')::uuid;
        if exists (select 1 from internal.supplier_items where variant_id = v_variant and is_primary) then
          update internal.supplier_items set
            cost_cents     = coalesce(internal.import_num(r, 'cost_cents'), cost_cents),
            on_hand_qty    = coalesce(internal.import_num(r, 'on_hand_qty')::int, on_hand_qty),
            aisle_location = coalesce(nullif(btrim(r ->> 'aisle_location'), ''), aisle_location),
            supplier_barcode = coalesce(nullif(btrim(r ->> 'barcode'), ''), supplier_barcode),
            inner_qty      = coalesce(internal.import_num(r, 'inner_qty')::int, inner_qty),
            inner_barcode  = coalesce(nullif(btrim(r ->> 'inner_barcode'), ''), inner_barcode),
            outer_qty      = coalesce(internal.import_num(r, 'outer_qty')::int, outer_qty),
            outer_barcode  = coalesce(nullif(btrim(r ->> 'outer_barcode'), ''), outer_barcode),
            last_checked_at = case when internal.import_num(r, 'on_hand_qty') is not null then now() else last_checked_at end
          where variant_id = v_variant and is_primary;
        elsif internal.import_num(r, 'cost_cents') is not null then
          insert into internal.supplier_items (supplier_id, variant_id, supplier_sku, supplier_barcode, cost_cents,
                                               on_hand_qty, aisle_location, is_primary, last_checked_at,
                                               inner_qty, inner_barcode, outer_qty, outer_barcode)
          values (v_supplier, v_variant, btrim(r ->> 'item_number'), nullif(btrim(r ->> 'barcode'), ''),
                  internal.import_num(r, 'cost_cents'), internal.import_num(r, 'on_hand_qty')::int,
                  nullif(btrim(r ->> 'aisle_location'), ''), true, now(),
                  internal.import_num(r, 'inner_qty')::int, nullif(btrim(r ->> 'inner_barcode'), ''),
                  internal.import_num(r, 'outer_qty')::int, nullif(btrim(r ->> 'outer_barcode'), ''));
        end if;
        if p_update_content then
          update public.products set
            name        = coalesce(nullif(btrim(coalesce(r ->> 'title', r ->> 'name')), ''), name),
            description = coalesce(nullif(btrim(r ->> 'description'), ''), description),
            category_id = coalesce(v_cat, category_id)
          where id = v_product;
        end if;
        v_updated := v_updated + 1;
      else
        v_same := v_same + 1;
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', r -> 'row', 'sku', v_sku, 'message', sqlerrm);
    end;
  end loop;

  perform internal.write_audit('catalog.import', 'public.products', null, null,
    jsonb_build_object('rows', jsonb_array_length(p_rows), 'new_products', v_created_p, 'new_items', v_created_v,
                       'updated', v_updated, 'errors', jsonb_array_length(v_errors)));
  return jsonb_build_object('created_products', v_created_p, 'created_items', v_created_v, 'updated', v_updated,
                            'unchanged', v_same, 'errors', v_errors);
end;
$$;

-- Which products do these photo files belong to? Names are item numbers ("HD-BLK-M", "HD-BLK-M-2",
-- "HD-BLK-M_3", "HD-BLK-M (2)") or a folder named after the item number.
create or replace function public.svc_photo_targets(p_actor uuid, p_names text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'catalog.edit');
  return coalesce((
    select jsonb_object_agg(n, jsonb_build_object(
             'product_id', v.product_id, 'variant_id', v.id, 'sku', v.sku, 'product', p.name,
             'multi_variant', (select count(*) > 1 from public.product_variants x where x.product_id = v.product_id),
             'existing', coalesce((select jsonb_agg(i.source_name) from public.product_images i
                                    where i.product_id = v.product_id and i.source_name is not null), '[]'::jsonb)))
      from unnest(p_names) n
      join public.product_variants v
        on v.sku = internal.normalize_sku(n)
        or v.id = (select si.variant_id from internal.supplier_items si where si.supplier_sku = n and si.is_primary limit 1)
      join public.products p on p.id = v.product_id
  ), '{}'::jsonb);
end;
$$;

-- Adds a photo; a file already uploaded for this product (same file name) is skipped.
create or replace function public.svc_image_add_named(
  p_actor uuid, p_product_id uuid, p_url text, p_alt text, p_source_name text, p_variant_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v uuid;
begin
  perform internal.act_as(p_actor, 'catalog.edit');
  if p_source_name is not null and exists (select 1 from public.product_images
                                            where product_id = p_product_id and source_name = p_source_name) then
    return null;
  end if;
  insert into public.product_images (product_id, variant_id, url, alt_text, sort_order, source_name)
  values (p_product_id, p_variant_id, p_url,
          coalesce(nullif(btrim(p_alt), ''), (select name from public.products where id = p_product_id)),
          (select coalesce(max(sort_order), -1) + 1 from public.product_images where product_id = p_product_id),
          p_source_name)
  returning id into v;
  return v;
end;
$$;

-- For AI setup: existing category names and the occasion/recipient vocabulary in use.
create or replace function public.svc_catalog_vocabulary(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'catalog.view');
  return jsonb_build_object(
    'categories', coalesce((select jsonb_agg(name order by sort_order, name) from public.categories), '[]'::jsonb),
    'occasions', coalesce((select jsonb_agg(distinct o) from public.products, unnest(occasions) o), '[]'::jsonb),
    'recipients', coalesce((select jsonb_agg(distinct x) from public.products, unnest(recipients) x), '[]'::jsonb));
end;
$$;

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
