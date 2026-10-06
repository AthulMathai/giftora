-- Inner packs and outer cases.
--
-- A supplier item can come in an inner pack (e.g. 6) and an outer case (e.g. 12), each with
-- its own barcode. Quantities everywhere stay in single units; a pack barcode simply counts
-- as several units when scanned.
--   * Pick list: required units are shown as the fewest outers + inners + singles.
--   * Sorting: a scanned pack goes WHOLE to one order that needs at least that many
--     (exact match first), so a customer who ordered a full inner gets it unopened.
--     Singles avoid orders whose remaining quantity is a whole number of packs.
--     If no order can take the whole pack, staff are told to open it and scan the items.
--   * Packing: a pack barcode verifies that many units at once.

alter table internal.supplier_items
  add column inner_qty int check (inner_qty > 1),
  add column inner_barcode text,
  add column outer_qty int check (outer_qty > 1),
  add column outer_barcode text,
  add constraint outer_bigger_than_inner check (outer_qty is null or inner_qty is null or outer_qty > inner_qty);

alter table internal.variant_barcodes
  add column pack_qty int not null default 1 check (pack_qty >= 1);
alter table internal.variant_barcodes drop constraint variant_barcodes_kind_check;
alter table internal.variant_barcodes add constraint variant_barcodes_kind_check
  check (kind in ('supplier', 'giftora_sku', 'qr', 'inner', 'outer'));

alter table internal.pick_lines
  add column inner_qty int,
  add column outer_qty int;

-- Keep pack barcodes in the scannable-code table.
create or replace function internal.sync_pack_barcodes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    delete from internal.variant_barcodes
     where variant_id = old.variant_id and kind in ('inner', 'outer')
       and code not in (coalesce(new.inner_barcode, ''), coalesce(new.outer_barcode, ''));
  end if;
  if coalesce(new.inner_barcode, '') <> '' and new.inner_qty is not null then
    insert into internal.variant_barcodes (variant_id, code, kind, pack_qty)
    values (new.variant_id, btrim(new.inner_barcode), 'inner', new.inner_qty)
    on conflict (code) do update set variant_id = excluded.variant_id, kind = 'inner', pack_qty = excluded.pack_qty;
  end if;
  if coalesce(new.outer_barcode, '') <> '' and new.outer_qty is not null then
    insert into internal.variant_barcodes (variant_id, code, kind, pack_qty)
    values (new.variant_id, btrim(new.outer_barcode), 'outer', new.outer_qty)
    on conflict (code) do update set variant_id = excluded.variant_id, kind = 'outer', pack_qty = excluded.pack_qty;
  end if;
  return new;
end;
$$;
create trigger supplier_items_pack_barcodes
  after insert or update of inner_barcode, inner_qty, outer_barcode, outer_qty on internal.supplier_items
  for each row execute function internal.sync_pack_barcodes();

-- Snapshot pack sizes onto pick lines when a session is created.
create or replace function internal.pick_line_packs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select si.inner_qty, si.outer_qty into new.inner_qty, new.outer_qty
    from internal.supplier_items si where si.variant_id = new.variant_id and si.is_primary;
  return new;
end;
$$;
create trigger pick_lines_packs before insert on internal.pick_lines
  for each row execute function internal.pick_line_packs();

-- Fewest packs that make up `qty` units: outers first, then inners, then singles.
create or replace function internal.pack_breakdown(qty int, inner_qty int, outer_qty int)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  o int := 0; i int := 0; r int := qty;
begin
  if outer_qty is not null and outer_qty > 1 then o := r / outer_qty; r := r - o * outer_qty; end if;
  if inner_qty is not null and inner_qty > 1 then i := r / inner_qty; r := r - i * inner_qty; end if;
  return jsonb_build_object('outers', o, 'inners', i, 'singles', r, 'outer_qty', outer_qty, 'inner_qty', inner_qty);
end;
$$;

-- Pack breakdown for every line of a session's pick list.
create or replace function public.svc_pick_packs(p_actor uuid, p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  return coalesce((
    select jsonb_object_agg(p.id, internal.pack_breakdown(p.required_qty, p.inner_qty, p.outer_qty)
             || jsonb_build_object(
                  'inner_barcode', (select si.inner_barcode from internal.supplier_items si where si.variant_id = p.variant_id and si.is_primary),
                  'outer_barcode', (select si.outer_barcode from internal.supplier_items si where si.variant_id = p.variant_id and si.is_primary)))
    from internal.pick_lines p where p.session_id = p_session_id), '{}'::jsonb);
end;
$$;

-- Code -> variant and how many units it represents.
create or replace function internal.resolve_pack(p_code text)
returns table (variant_id uuid, pack_qty int, kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.variant_id, b.pack_qty, b.kind from internal.variant_barcodes b
   where b.code = btrim(p_code) or b.code = upper(btrim(p_code))
   order by (b.code = btrim(p_code)) desc
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Scan-to-sort, pack-aware (replaces the fulfillment version)
-- ---------------------------------------------------------------------------
create or replace function public.svc_sort_scan(p_actor uuid, p_session_id uuid, p_code text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev     jsonb;
  v_variant  uuid;
  v_pack     int;
  v_kind     text;
  v_inner    int;
  v_line     record;
  v_resp     jsonb;
  v_result   text;
  v_done     boolean;
  v_expected jsonb;
  v_vrow     record;
  v_item_id  uuid;
  v_bin_id   uuid;
  v_unit     text;
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  select response into v_prev from internal.scan_events where idempotency_key = p_key;
  if v_prev is not null then return v_prev; end if;

  select r.variant_id, r.pack_qty, r.kind into v_variant, v_pack, v_kind from internal.resolve_pack(p_code) r;
  v_pack := coalesce(v_pack, 1);
  v_unit := case v_kind when 'outer' then 'OUTER' when 'inner' then 'INNER' else 'item' end;

  if v_variant is null then
    v_result := 'unknown_code';
    v_resp := jsonb_build_object('result', v_result, 'code', p_code,
                                 'message', 'This barcode isn''t linked to any product. Enter the SKU by hand or check the item.');
  else
    select v.sku, v.label, p.name as product, v.product_id into v_vrow
      from public.product_variants v join public.products p on p.id = v.product_id where v.id = v_variant;
    select si.inner_qty into v_inner from internal.supplier_items si where si.variant_id = v_variant and si.is_primary;

    select oi.id, oi.order_id, oi.quantity, oi.sorted_qty, o.order_number, f.bin_id, b.code as bin
      into v_line
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      join internal.fulfillment_session_orders f on f.order_id = o.id and f.session_id = p_session_id and f.removed_at is null
      left join internal.bins b on b.id = f.bin_id
     where oi.variant_id = v_variant and oi.status <> 'cancelled'
       and o.status in ('processing', 'ready_to_ship')
       and oi.quantity - oi.sorted_qty >= v_pack          -- a pack only goes whole into one order
     order by
       case when v_pack > 1 then (oi.quantity - oi.sorted_qty = v_pack) end desc nulls last,  -- packs: exact fit first
       o.ship_by nulls last,
       o.priority desc,
       -- singles: keep orders that need whole packs free for those packs
       case when v_pack = 1 and v_inner is not null and (oi.quantity - oi.sorted_qty) % v_inner = 0 then 1 else 0 end,
       (oi.quantity - oi.sorted_qty),
       o.paid_at
     limit 1
     for update of oi;

    if v_line.id is null then
      if v_pack > 1 and exists (
        select 1 from public.order_items oi
          join internal.fulfillment_session_orders f on f.order_id = oi.order_id and f.session_id = p_session_id and f.removed_at is null
         where oi.variant_id = v_variant and oi.sorted_qty < oi.quantity and oi.status <> 'cancelled') then
        v_result := 'open_pack';
        v_resp := jsonb_build_object('result', v_result, 'sku', v_vrow.sku, 'product', v_vrow.product, 'variant', v_vrow.label,
                                     'pack_qty', v_pack,
                                     'message', format('OPEN THIS %s: no single order needs all %s. Open it and scan the items one by one.', v_unit, v_pack));
      else
        select jsonb_agg(distinct jsonb_build_object('sku', v2.sku, 'variant', v2.label)) into v_expected
          from public.order_items oi
          join public.product_variants v2 on v2.id = oi.variant_id
          join internal.fulfillment_session_orders f on f.order_id = oi.order_id and f.session_id = p_session_id and f.removed_at is null
         where v2.product_id = v_vrow.product_id and v2.id <> v_variant and oi.sorted_qty < oi.quantity;
        if v_expected is not null then
          v_result := 'wrong_variant';
          v_resp := jsonb_build_object('result', v_result, 'sku', v_vrow.sku, 'product', v_vrow.product, 'variant', v_vrow.label,
                                       'expected', v_expected,
                                       'message', format('WRONG VARIANT: scanned %s, but this session needs %s.', v_vrow.label,
                                         (select string_agg(e ->> 'variant', ' or ') from jsonb_array_elements(v_expected) e)));
        else
          v_result := 'not_required';
          v_resp := jsonb_build_object('result', v_result, 'sku', v_vrow.sku, 'product', v_vrow.product, 'variant', v_vrow.label,
                                       'message', 'ITEM NOT REQUIRED: no order in this session still needs this item. Set it aside.');
        end if;
        insert into internal.fulfillment_exceptions (kind, session_id, variant_id, sku, quantity, notes, created_by)
        values (case when v_result = 'wrong_variant' then 'wrong_variant' else 'unexpected_item' end,
                p_session_id, v_variant, v_vrow.sku, v_pack, 'Scanned during sorting', p_actor);
      end if;
    else
      v_item_id := v_line.id;
      v_bin_id := v_line.bin_id;
      update public.order_items
         set sorted_qty = sorted_qty + v_pack,
             status = case when sorted_qty + v_pack = quantity then 'sorted' else status end
       where id = v_line.id;
      select bool_and(sorted_qty >= quantity) into v_done from public.order_items
       where order_id = v_line.order_id and status <> 'cancelled';
      if v_done then
        update public.orders set status = 'ready_to_ship' where id = v_line.order_id and status = 'processing';
        update internal.fulfillment_sessions set status = 'packing' where id = p_session_id and status in ('picking', 'sorting')
          and not exists (select 1 from internal.fulfillment_session_orders f join public.orders o on o.id = f.order_id
                          where f.session_id = p_session_id and f.removed_at is null and o.status = 'processing');
      end if;
      v_result := 'ok';
      v_resp := jsonb_build_object('result', 'ok', 'bin', v_line.bin, 'order_number', v_line.order_number,
                                   'sku', v_vrow.sku, 'product', v_vrow.product, 'variant', v_vrow.label,
                                   'pack_qty', v_pack, 'pack_kind', v_kind,
                                   'sorted', v_line.sorted_qty + v_pack, 'required', v_line.quantity,
                                   'order_complete', coalesce(v_done, false));
    end if;
  end if;

  insert into internal.scan_events (session_id, kind, code, variant_id, order_item_id, bin_id, result, response, idempotency_key, actor_id)
  values (p_session_id, 'sort', p_code, v_variant, v_item_id, v_bin_id, v_result,
          v_resp || jsonb_build_object('at', now()), p_key, p_actor);
  return v_resp;
end;
$$;

-- Pack verification, pack-aware (replaces the fulfillment version)
create or replace function public.svc_pack_scan(p_actor uuid, p_order_id uuid, p_code text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev    jsonb;
  v_variant uuid;
  v_pack    int;
  v_kind    text;
  v_line    record;
  v_resp    jsonb;
  v_done    boolean;
  v_item_id uuid;
  v_session uuid := internal.active_session_of(p_order_id);
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  select response into v_prev from internal.scan_events where idempotency_key = p_key;
  if v_prev is not null then return v_prev; end if;

  if (select status from public.orders where id = p_order_id) <> 'ready_to_ship' then
    v_resp := jsonb_build_object('result', 'not_ready', 'message', 'This order isn''t fully sorted yet, or is already packed.');
  else
    select r.variant_id, r.pack_qty, r.kind into v_variant, v_pack, v_kind from internal.resolve_pack(p_code) r;
    v_pack := coalesce(v_pack, 1);
    select oi.id, oi.sku, oi.product_name, oi.variant_label, oi.quantity, oi.packed_qty into v_line
      from public.order_items oi
     where oi.order_id = p_order_id and oi.variant_id = v_variant and oi.status <> 'cancelled'
     order by (oi.packed_qty < oi.quantity) desc
     limit 1 for update;
    if v_variant is null then
      v_resp := jsonb_build_object('result', 'unknown_code', 'message', 'Unknown barcode.');
    elsif v_line.id is null then
      v_resp := jsonb_build_object('result', 'not_in_order', 'message', 'NOT IN THIS ORDER. Take it out of the box.');
    elsif v_line.packed_qty >= v_line.quantity then
      v_resp := jsonb_build_object('result', 'already_packed', 'sku', v_line.sku,
                                   'message', format('Already packed all %s of %s. Take the extra out.', v_line.quantity, v_line.sku));
    elsif v_line.packed_qty + v_pack > v_line.quantity then
      v_resp := jsonb_build_object('result', 'open_pack', 'sku', v_line.sku, 'pack_qty', v_pack,
                                   'message', format('This %s holds %s, but the order only needs %s more. Open it and scan the items.',
                                                     coalesce(v_kind, 'pack'), v_pack, v_line.quantity - v_line.packed_qty));
    else
      v_item_id := v_line.id;
      update public.order_items
         set packed_qty = packed_qty + v_pack,
             status = case when packed_qty + v_pack = quantity then 'packed' else status end
       where id = v_line.id;
      select bool_and(packed_qty >= quantity) into v_done from public.order_items
       where order_id = p_order_id and status <> 'cancelled';
      if v_done then
        update public.orders set status = 'packed' where id = p_order_id;
      end if;
      v_resp := jsonb_build_object('result', 'ok', 'sku', v_line.sku, 'product', v_line.product_name, 'variant', v_line.variant_label,
                                   'pack_qty', v_pack, 'pack_kind', v_kind,
                                   'packed', v_line.packed_qty + v_pack, 'required', v_line.quantity, 'order_complete', coalesce(v_done, false));
    end if;
  end if;

  insert into internal.scan_events (session_id, kind, code, variant_id, order_item_id, result, response, idempotency_key, actor_id)
  values (v_session, 'pack', p_code, v_variant, v_item_id, v_resp ->> 'result', v_resp || jsonb_build_object('at', now()), p_key, p_actor);
  return v_resp;
end;
$$;

-- ---------------------------------------------------------------------------
-- Variant editor: pack sizes and barcodes (replaces the catalog_admin version)
-- ---------------------------------------------------------------------------
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
                                         on_hand_qty, status, aisle_location, is_primary, last_checked_at,
                                         inner_qty, inner_barcode, outer_qty, outer_barcode)
    values (v_supplier, v_id, nullif(btrim(p ->> 'supplier_sku'), ''), nullif(btrim(p ->> 'supplier_barcode'), ''),
            (p ->> 'cost_cents')::bigint, nullif(p ->> 'on_hand_qty', '')::int,
            coalesce(nullif(p ->> 'supply_status', ''), 'available')::internal.supplier_item_status,
            nullif(btrim(p ->> 'aisle_location'), ''), true, now(),
            nullif(p ->> 'inner_qty', '')::int, nullif(btrim(p ->> 'inner_barcode'), ''),
            nullif(p ->> 'outer_qty', '')::int, nullif(btrim(p ->> 'outer_barcode'), ''))
    on conflict (supplier_id, variant_id) do update set
      supplier_sku = excluded.supplier_sku,
      supplier_barcode = excluded.supplier_barcode,
      cost_cents = excluded.cost_cents,
      on_hand_qty = excluded.on_hand_qty,
      status = excluded.status,
      aisle_location = excluded.aisle_location,
      inner_qty = excluded.inner_qty,
      inner_barcode = excluded.inner_barcode,
      outer_qty = excluded.outer_qty,
      outer_barcode = excluded.outer_barcode,
      is_primary = true,
      last_checked_at = now();
  end if;
  return v_id;
end;
$$;

-- The editor needs to read pack fields back.
create or replace function public.svc_variant_packs(p_actor uuid, p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'suppliers.view');
  return coalesce((
    select jsonb_object_agg(v.id, jsonb_build_object('inner_qty', si.inner_qty, 'inner_barcode', si.inner_barcode,
                                                      'outer_qty', si.outer_qty, 'outer_barcode', si.outer_barcode))
    from public.product_variants v
    join internal.supplier_items si on si.variant_id = v.id and si.is_primary
    where v.product_id = p_product_id), '{}'::jsonb);
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
