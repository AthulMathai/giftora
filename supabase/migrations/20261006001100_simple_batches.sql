-- Simpler fulfillment: batches.
--   1. Start a batch       -> batch number B-YYMMDD-NN, every waiting order gets a bin
--   2. Pick                -> "got everything" in one tap, or mark what was short
--   3. Sort & label        -> scan into bins; a full bin's label can print right away
--   4. Hand to carrier     -> ship the whole batch in one step
-- No packing re-scan: sorting by scan is the verification. Scans that don't fit just say what
-- to do; they no longer open exception tickets.

alter table internal.fulfillment_session_orders
  add column label_printed_at timestamptz,
  add column label_print_count int not null default 0;

insert into internal.system_settings (key, value, description) values
  ('shipping.return_address',
   '{"name":"Giftora","line1":"","line2":"","city":"Toronto","province":"ON","postal_code":"","phone":""}',
   'Return address printed on shipping labels')
on conflict (key) do nothing;

-- B-261006-01: date (Toronto) + run number that day.
create or replace function internal.next_batch_code()
returns text
language sql
security definer
set search_path = ''
as $$
  select 'B-' || to_char(now() at time zone 'America/Toronto', 'YYMMDD') || '-' ||
         lpad((count(*) + 1)::text, 2, '0')
  from internal.fulfillment_sessions
  where code like 'B-' || to_char(now() at time zone 'America/Toronto', 'YYMMDD') || '-%';
$$;

-- ---------------------------------------------------------------------------
-- Start a batch (replaces svc_session_create; same inputs)
-- ---------------------------------------------------------------------------
create or replace function public.svc_session_create(p_actor uuid, p_from date, p_to date, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
  v_pos     int := 0;
  r         record;
  v_bin     uuid;
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  -- Serialize batch creation so batch numbers never collide.
  perform pg_advisory_xact_lock(hashtext('giftora.batch'));

  insert into internal.fulfillment_sessions (code, date_from, date_to, notes, created_by)
  values (internal.next_batch_code(), p_from, p_to, p_notes, p_actor)
  returning id into v_session;

  for r in
    select o.id from public.orders o
     where o.status = 'paid'
       and internal.local_date(o.paid_at) between p_from and p_to
       and internal.active_session_of(o.id) is null
     order by o.paid_at, o.order_number
     for update skip locked
  loop
    v_pos := v_pos + 1;
    v_bin := internal.next_bin();
    update internal.bins set status = 'assigned', current_order_id = r.id where id = v_bin;
    insert into internal.bin_assignments (bin_id, order_id, session_id) values (v_bin, r.id, v_session);
    insert into internal.fulfillment_session_orders (session_id, order_id, bin_id, position) values (v_session, r.id, v_bin, v_pos);
    update public.orders set status = 'processing' where id = r.id;
    insert into public.order_events (order_id, type, message, visible_to_customer, actor_id)
    values (r.id, 'processing', 'Your gift is being prepared', true, p_actor);
  end loop;

  if v_pos = 0 then
    raise exception 'No paid orders are waiting' using errcode = 'P0030';
  end if;

  insert into internal.pick_lines (session_id, variant_id, sku, product_name, variant_label, aisle_location, required_qty)
  select v_session, oi.variant_id, oi.sku, min(oi.product_name), min(oi.variant_label),
         (select si.aisle_location from internal.supplier_items si where si.variant_id = oi.variant_id and si.is_primary),
         sum(oi.quantity)
    from public.order_items oi
    join internal.fulfillment_session_orders fso on fso.order_id = oi.order_id and fso.session_id = v_session
   group by oi.variant_id, oi.sku;

  perform internal.write_audit('batch.create', 'internal.fulfillment_sessions', v_session::text, null,
                               jsonb_build_object('orders', v_pos, 'from', p_from, 'to', p_to));
  return v_session;
end;
$$;

-- "Got everything": every line not yet recorded is marked fully picked.
create or replace function public.svc_pick_all(p_actor uuid, p_session_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  for r in select id, required_qty from internal.pick_lines
            where session_id = p_session_id and picked_qty + short_qty < required_qty loop
    perform public.svc_pick_update(p_actor, r.id, r.required_qty - (select short_qty from internal.pick_lines where id = r.id),
                                   (select short_qty from internal.pick_lines where id = r.id), 0, null);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scan-to-sort without exception tickets (replaces the case-pack version)
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
  v_expected text;
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
  v_unit := case v_kind when 'outer' then 'outer case' when 'inner' then 'inner pack' else 'item' end;

  if v_variant is null then
    v_result := 'unknown_code';
    v_resp := jsonb_build_object('result', v_result, 'code', p_code,
                                 'message', 'Barcode not recognised. Type the SKU from the item instead.');
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
       and oi.quantity - oi.sorted_qty >= v_pack
     order by
       case when v_pack > 1 then (oi.quantity - oi.sorted_qty = v_pack) end desc nulls last,
       o.ship_by nulls last,
       o.priority desc,
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
                                     'message', format('Open this %s and scan the items one by one.', v_unit));
      else
        select string_agg(distinct v2.label, ' or ') into v_expected
          from public.order_items oi
          join public.product_variants v2 on v2.id = oi.variant_id
          join internal.fulfillment_session_orders f on f.order_id = oi.order_id and f.session_id = p_session_id and f.removed_at is null
         where v2.product_id = v_vrow.product_id and v2.id <> v_variant and oi.sorted_qty < oi.quantity;
        if v_expected is not null then
          v_result := 'wrong_variant';
          v_resp := jsonb_build_object('result', v_result, 'sku', v_vrow.sku, 'product', v_vrow.product, 'variant', v_vrow.label,
                                       'message', format('Wrong option (%s). This batch needs %s. Put this one aside.', v_vrow.label, v_expected));
        else
          v_result := 'not_required';
          v_resp := jsonb_build_object('result', v_result, 'sku', v_vrow.sku, 'product', v_vrow.product, 'variant', v_vrow.label,
                                       'message', 'Not needed in this batch. Put it aside.');
        end if;
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
      v_resp := jsonb_build_object('result', 'ok', 'bin', v_line.bin, 'order_id', v_line.order_id,
                                   'order_number', v_line.order_number,
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

-- ---------------------------------------------------------------------------
-- Labels
-- ---------------------------------------------------------------------------
create or replace function public.svc_label_data(p_actor uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  return (
    select jsonb_build_object(
      'order_id', o.id, 'order_number', o.order_number, 'status', o.status,
      'ship_to', o.shipping_address, 'shipping_method', o.shipping_method_name,
      'carrier', o.carrier, 'tracking_number', o.tracking_number,
      'batch', s.code, 'bin', b.code,
      'units', (select sum(quantity) from public.order_items where order_id = o.id and status <> 'cancelled'),
      'items', (select jsonb_agg(jsonb_build_object('sku', sku, 'product', product_name, 'variant', variant_label, 'quantity', quantity) order by sku)
                from public.order_items where order_id = o.id and status <> 'cancelled'),
      'return_address', (select value from internal.system_settings where key = 'shipping.return_address'),
      'printed_count', coalesce(f.label_print_count, 0))
    from public.orders o
    left join internal.fulfillment_session_orders f on f.order_id = o.id and f.removed_at is null
    left join internal.fulfillment_sessions s on s.id = f.session_id
    left join internal.bins b on b.id = f.bin_id
    where o.id = p_order_id
  );
end;
$$;

-- Called when a label is printed. First print marks the order packed (labelled); reprints are audited.
create or replace function public.svc_label_printed(p_actor uuid, p_order_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
  v_status public.order_status;
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  select status into v_status from public.orders where id = p_order_id for update;
  if v_status not in ('ready_to_ship', 'packed', 'shipped') then
    raise exception 'This bin is not complete yet' using errcode = 'P0050';
  end if;
  update internal.fulfillment_session_orders
     set label_print_count = label_print_count + 1, label_printed_at = now()
   where order_id = p_order_id and removed_at is null
  returning label_print_count into n;
  if v_status = 'ready_to_ship' then
    update public.order_items set packed_qty = quantity, status = 'packed' where order_id = p_order_id and status <> 'cancelled';
    update public.orders set status = 'packed' where id = p_order_id;
    insert into public.order_events (order_id, type, message, visible_to_customer, actor_id)
    values (p_order_id, 'packed', 'Packed and ready for the carrier', true, p_actor);
  end if;
  if coalesce(n, 0) > 1 then
    perform internal.write_audit('label.reprint', 'public.orders', p_order_id::text, null, jsonb_build_object('count', n));
  end if;
  return coalesce(n, 1);
end;
$$;

-- Label + bin status for every order in a batch.
create or replace function public.svc_batch_labels(p_actor uuid, p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  return coalesce((select jsonb_object_agg(order_id, jsonb_build_object('printed_at', label_printed_at, 'count', label_print_count))
                   from internal.fulfillment_session_orders where session_id = p_session_id), '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Shipping: lock = bin fully sorted; tracking optional (replaces the fulfillment version)
-- ---------------------------------------------------------------------------
create or replace function public.svc_update_order_status(
  p_actor uuid, p_order_id uuid, p_status public.order_status,
  p_carrier text default null, p_tracking_number text default null, p_tracking_url text default null,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.order_status;
  v_msg text;
  v_in_session boolean := internal.active_session_of(p_order_id) is not null;
begin
  perform internal.act_as(p_actor, 'orders.edit');
  select status into v_old from public.orders where id = p_order_id for update;
  if v_old is null then raise exception 'order not found'; end if;

  if p_status = 'shipped' and v_in_session and v_old not in ('ready_to_ship', 'packed') then
    raise exception 'Label locked: finish sorting this bin first.' using errcode = 'P0012';
  end if;
  if not (
    (v_old = 'paid' and p_status in ('processing', 'shipped')) or
    (v_old = 'processing' and p_status = 'shipped') or
    (v_old in ('ready_to_ship', 'packed') and p_status = 'shipped') or
    (v_old = 'shipped' and p_status = 'delivered')
  ) then
    raise exception 'cannot move an order from % to %', v_old, p_status using errcode = 'P0010';
  end if;
  if p_status = 'shipped' and coalesce(p_carrier, '') = '' then
    raise exception 'Choose the carrier to ship (tracking number optional)' using errcode = 'P0011';
  end if;

  update public.orders
     set status = p_status,
         carrier = coalesce(p_carrier, carrier),
         tracking_number = coalesce(nullif(p_tracking_number, ''), tracking_number),
         tracking_url = coalesce(p_tracking_url, tracking_url),
         shipped_at = case when p_status = 'shipped' then now() else shipped_at end,
         delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
         staff_note = coalesce(p_note, staff_note)
   where id = p_order_id;

  if p_status in ('processing', 'shipped') then
    update public.order_items set status = 'acquired'
     where order_id = p_order_id and status = 'acquisition_pending';
    perform internal.acquire_reservations(array(select id from public.order_items where order_id = p_order_id));
  end if;
  if p_status = 'shipped' then
    perform internal.release_bin(p_order_id);
  end if;

  v_msg := case p_status
    when 'processing' then 'Your gift is being prepared'
    when 'shipped' then 'Shipped with ' || p_carrier
    when 'delivered' then 'Delivered'
  end;
  insert into public.order_events (order_id, type, message, data, visible_to_customer, actor_id)
  values (p_order_id, p_status::text, v_msg,
          jsonb_strip_nulls(jsonb_build_object('carrier', p_carrier, 'tracking_number', nullif(p_tracking_number, ''),
                                               'tracking_url', p_tracking_url)),
          true, p_actor);
  perform internal.write_audit('order.status', 'public.orders', p_order_id::text,
                               jsonb_build_object('status', v_old), jsonb_build_object('status', p_status), p_note);
  if p_status = 'shipped' then
    perform internal.enqueue('order.shipped', jsonb_build_object('order_id', p_order_id));
  end if;
end;
$$;

-- Hand the whole batch to the carrier: every labelled order ships; the batch closes when done.
create or replace function public.svc_batch_ship(p_actor uuid, p_session_id uuid, p_carrier text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  perform internal.act_as(p_actor, 'orders.edit');
  for r in
    select f.order_id from internal.fulfillment_session_orders f join public.orders o on o.id = f.order_id
     where f.session_id = p_session_id and f.removed_at is null and o.status = 'packed'
     order by f.position
  loop
    perform public.svc_update_order_status(p_actor, r.order_id, 'shipped', p_carrier);
    n := n + 1;
  end loop;
  if not exists (select 1 from internal.fulfillment_session_orders f join public.orders o on o.id = f.order_id
                  where f.session_id = p_session_id and f.removed_at is null
                    and o.status not in ('shipped', 'delivered', 'cancelled')) then
    update internal.fulfillment_sessions set status = 'completed', completed_at = now()
     where id = p_session_id and status <> 'completed';
  end if;
  return n;
end;
$$;

-- Staff order list now shows the batch and bin (replaces the service_api version).
create or replace function public.svc_staff_orders(
  p_actor uuid, p_statuses public.order_status[] default null, p_limit int default 100
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finance boolean;
begin
  perform internal.act_as(p_actor, 'orders.view');
  v_finance := internal.has_permission(p_actor, 'finance.view');
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.paid_at nulls last, x.placed_at)
    from (
      select o.id, o.order_number, o.status, o.payment_status, o.email,
             o.shipping_address ->> 'full_name' as customer,
             o.shipping_address, o.shipping_method_name, o.total_cents, o.ship_by,
             o.placed_at, o.paid_at, o.shipped_at, o.carrier, o.tracking_number, o.staff_note,
             (select s.code from internal.fulfillment_session_orders f join internal.fulfillment_sessions s on s.id = f.session_id
               where f.order_id = o.id and f.removed_at is null order by f.added_at desc limit 1) as batch,
             (select s.id from internal.fulfillment_session_orders f join internal.fulfillment_sessions s on s.id = f.session_id
               where f.order_id = o.id and f.removed_at is null order by f.added_at desc limit 1) as batch_id,
             (select b.code from internal.fulfillment_session_orders f join internal.bins b on b.id = f.bin_id
               where f.order_id = o.id and f.removed_at is null order by f.added_at desc limit 1) as bin,
             (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                        'sku', oi.sku, 'product', oi.product_name, 'variant', oi.variant_label,
                        'quantity', oi.quantity, 'unit_price_cents', oi.unit_price_cents,
                        'status', oi.status,
                        'unit_cost_cents', case when v_finance then s.unit_cost_cents end))
                      order by oi.sku)
                from public.order_items oi
                left join internal.order_financial_snapshots s on s.order_item_id = oi.id
               where oi.order_id = o.id) as items,
             case when v_finance then
               (select sum(expected_profit_cents) from internal.order_financial_snapshots where order_id = o.id)
               - coalesce((select sum(amount_cents) from internal.order_adjustments where order_id = o.id), 0)
             end as profit_cents
      from public.orders o
      where (p_statuses is null and o.status <> 'pending_payment' and o.status <> 'cancelled')
         or o.status = any(p_statuses)
      order by o.paid_at nulls last, o.placed_at
      limit p_limit
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.svc_return_address_save(p_actor uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'settings.edit');
  update internal.system_settings set value = p where key = 'shipping.return_address';
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
