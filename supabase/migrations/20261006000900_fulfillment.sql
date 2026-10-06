-- Fulfillment Center: picking sessions, reusable bins, scan-to-sort, pack verification,
-- exceptions and refunds.
--
-- Order flow:  paid --(session created)--> processing --(all items sorted)--> ready_to_ship
--              --(all items packed)--> packed --(tracking entered)--> shipped
-- Shipping an order that is in a session is LOCKED until it is packed, unless a manager
-- with fulfillment.override records a reason.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table internal.bins (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique check (code ~ '^BIN-[0-9]{3,}$'),
  status            text not null default 'available' check (status in ('available', 'assigned', 'out_of_service')),
  current_order_id  uuid unique references public.orders (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger bins_updated_at before update on internal.bins
  for each row execute function internal.set_updated_at();

create sequence internal.fulfillment_session_seq start with 1;

create table internal.fulfillment_sessions (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  status        text not null default 'picking' check (status in ('picking', 'sorting', 'packing', 'completed', 'cancelled')),
  date_from     date not null,
  date_to       date not null,
  notes         text,
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  check (date_to >= date_from)
);

create table internal.fulfillment_session_orders (
  session_id   uuid not null references internal.fulfillment_sessions (id),
  order_id     uuid not null references public.orders (id),
  bin_id       uuid references internal.bins (id),
  position     int not null,
  added_at     timestamptz not null default now(),
  removed_at   timestamptz,
  removed_reason text,
  primary key (session_id, order_id)
);
-- An order is in at most one session at a time.
create unique index fso_one_active_session on internal.fulfillment_session_orders (order_id) where removed_at is null;
create index fso_bin_idx on internal.fulfillment_session_orders (bin_id);

create table internal.bin_assignments (
  id           bigint generated always as identity primary key,
  bin_id       uuid not null references internal.bins (id),
  order_id     uuid not null references public.orders (id),
  session_id   uuid references internal.fulfillment_sessions (id),
  assigned_at  timestamptz not null default now(),
  released_at  timestamptz
);
create index bin_assignments_bin_idx on internal.bin_assignments (bin_id);
create index bin_assignments_order_idx on internal.bin_assignments (order_id);
create index bin_assignments_session_idx on internal.bin_assignments (session_id);

create table internal.pick_lines (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references internal.fulfillment_sessions (id),
  variant_id     uuid not null references public.product_variants (id),
  sku            text not null,
  product_name   text not null,
  variant_label  text not null,
  aisle_location text,
  required_qty   int not null check (required_qty > 0),
  picked_qty     int not null default 0 check (picked_qty >= 0),
  short_qty      int not null default 0 check (short_qty >= 0),
  damaged_qty    int not null default 0 check (damaged_qty >= 0),
  notes          text,
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  unique (session_id, variant_id)
);
create index pick_lines_variant_idx on internal.pick_lines (variant_id);

create table internal.scan_events (
  id               bigint generated always as identity primary key,
  session_id       uuid references internal.fulfillment_sessions (id),
  kind             text not null check (kind in ('sort', 'pack')),
  code             text not null,
  variant_id       uuid references public.product_variants (id),
  order_item_id    uuid references public.order_items (id),
  bin_id           uuid references internal.bins (id),
  result           text not null,
  response         jsonb not null,
  idempotency_key  text unique,
  actor_id         uuid,
  created_at       timestamptz not null default now()
);
create index scan_events_session_idx on internal.scan_events (session_id, created_at);
create index scan_events_variant_idx on internal.scan_events (variant_id);
create index scan_events_order_item_idx on internal.scan_events (order_item_id);
create index scan_events_bin_idx on internal.scan_events (bin_id);

create table internal.fulfillment_exceptions (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('short_pick', 'damaged', 'wrong_variant', 'unexpected_item',
                                              'unknown_code', 'supplier_unavailable', 'address_problem',
                                              'shipping_problem', 'other')),
  status         text not null default 'open' check (status in ('open', 'resolved')),
  session_id     uuid references internal.fulfillment_sessions (id),
  order_id       uuid references public.orders (id),
  variant_id     uuid references public.product_variants (id),
  sku            text,
  quantity       int,
  notes          text,
  resolution     text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  resolved_by    uuid,
  resolved_at    timestamptz
);
create index exceptions_open_idx on internal.fulfillment_exceptions (status, created_at);
create index exceptions_session_idx on internal.fulfillment_exceptions (session_id);
create index exceptions_order_idx on internal.fulfillment_exceptions (order_id);
create index exceptions_variant_idx on internal.fulfillment_exceptions (variant_id);
create trigger exceptions_audit after insert or update on internal.fulfillment_exceptions
  for each row execute function internal.audit_row_change();

-- Seed 20 bins to start with; more are created automatically when a session needs them.
insert into internal.bins (code) select 'BIN-' || lpad(n::text, 3, '0') from generate_series(1, 20) n;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function internal.local_date(t timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$ select (t at time zone 'America/Toronto')::date $$;

create or replace function internal.release_bin(p_order_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update internal.bin_assignments set released_at = now() where order_id = p_order_id and released_at is null;
  update internal.bins set status = 'available', current_order_id = null where current_order_id = p_order_id;
$$;

create or replace function internal.next_bin()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
  n int;
begin
  select id into v from internal.bins where status = 'available' order by code limit 1 for update skip locked;
  if v is null then
    select coalesce(max(substring(code from 5)::int), 0) + 1 into n from internal.bins;
    insert into internal.bins (code) values ('BIN-' || lpad(n::text, 3, '0')) returning id into v;
  end if;
  return v;
end;
$$;

-- Items physically bought from the supplier: stop counting the claim and take the units
-- off the supplier's shelf count, so the same units can never be sold twice.
create or replace function internal.acquire_reservations(p_order_item_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  with acquired as (
    update internal.inventory_reservations
       set status = 'acquired'
     where order_item_id = any(p_order_item_ids) and status = 'confirmed'
    returning supplier_item_id, quantity
  ), totals as (
    select supplier_item_id, sum(quantity) as qty from acquired group by supplier_item_id
  )
  update internal.supplier_items si
     set on_hand_qty = greatest(0, coalesce(si.on_hand_qty, 0) - totals.qty)
    from totals where si.id = totals.supplier_item_id;
$$;

-- Orders in a live session (not removed, not finished).
create or replace function internal.active_session_of(p_order_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select fso.session_id from internal.fulfillment_session_orders fso
  join internal.fulfillment_sessions s on s.id = fso.session_id
  where fso.order_id = p_order_id and fso.removed_at is null and s.status not in ('completed', 'cancelled');
$$;

-- ---------------------------------------------------------------------------
-- Volume and sessions
-- ---------------------------------------------------------------------------
-- Paid orders waiting for a session, per day (Toronto time) in the range.
create or replace function public.svc_fulfillment_volume(p_actor uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.day)
    from (
      select internal.local_date(o.paid_at) as day,
             count(distinct o.id) as orders,
             count(oi.id) as lines,
             count(distinct oi.variant_id) as unique_skus,
             sum(oi.quantity) as units,
             count(distinct o.id) filter (where internal.active_session_of(o.id) is null and o.status = 'paid') as waiting,
             count(distinct o.id) filter (where o.status in ('processing', 'ready_to_ship', 'packed')) as in_progress,
             count(distinct o.id) filter (where o.status in ('shipped', 'delivered')) as shipped
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      where o.paid_at is not null
        and internal.local_date(o.paid_at) between p_from and p_to
        and o.status not in ('cancelled', 'pending_payment')
      group by 1
    ) x
  ), '[]'::jsonb);
end;
$$;

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

  insert into internal.fulfillment_sessions (code, date_from, date_to, notes, created_by)
  values ('FS-' || lpad(nextval('internal.fulfillment_session_seq')::text, 4, '0'), p_from, p_to, p_notes, p_actor)
  returning id into v_session;

  -- Eligible: paid, in range, not already in a live session. Lock so two sessions can't grab the same order.
  for r in
    select o.id, o.order_number from public.orders o
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
    raise exception 'No paid orders are waiting in that date range' using errcode = 'P0030';
  end if;

  insert into internal.pick_lines (session_id, variant_id, sku, product_name, variant_label, aisle_location, required_qty)
  select v_session, oi.variant_id, oi.sku, min(oi.product_name), min(oi.variant_label),
         (select si.aisle_location from internal.supplier_items si where si.variant_id = oi.variant_id and si.is_primary),
         sum(oi.quantity)
    from public.order_items oi
    join internal.fulfillment_session_orders fso on fso.order_id = oi.order_id and fso.session_id = v_session
   group by oi.variant_id, oi.sku;

  perform internal.write_audit('session.create', 'internal.fulfillment_sessions', v_session::text, null,
                               jsonb_build_object('orders', v_pos, 'from', p_from, 'to', p_to));
  return v_session;
end;
$$;

create or replace function public.svc_sessions(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc)
    from (
      select s.id, s.code, s.status, s.date_from, s.date_to, s.created_at, s.completed_at,
             (select display_name from internal.staff_members where user_id = s.created_by) as created_by,
             (select count(*) from internal.fulfillment_session_orders f where f.session_id = s.id and f.removed_at is null) as orders,
             (select coalesce(sum(required_qty), 0) from internal.pick_lines p where p.session_id = s.id) as units,
             (select count(*) from internal.fulfillment_session_orders f join public.orders o on o.id = f.order_id
               where f.session_id = s.id and f.removed_at is null and o.status in ('shipped', 'delivered')) as shipped
      from internal.fulfillment_sessions s
      order by s.created_at desc limit 50
    ) x), '[]'::jsonb);
end;
$$;

create or replace function public.svc_session_get(p_actor uuid, p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  return (
    select jsonb_build_object(
      'id', s.id, 'code', s.code, 'status', s.status, 'date_from', s.date_from, 'date_to', s.date_to,
      'notes', s.notes, 'created_at', s.created_at, 'completed_at', s.completed_at,
      'created_by', (select display_name from internal.staff_members where user_id = s.created_by),
      'pick_lines', coalesce((select jsonb_agg(jsonb_build_object(
          'id', p.id, 'variant_id', p.variant_id, 'sku', p.sku, 'product', p.product_name, 'variant', p.variant_label,
          'aisle', p.aisle_location, 'required', p.required_qty, 'picked', p.picked_qty, 'short', p.short_qty,
          'damaged', p.damaged_qty, 'notes', p.notes,
          'barcode', (select string_agg(b.code, ', ' order by b.kind desc) from internal.variant_barcodes b where b.variant_id = p.variant_id))
        order by p.aisle_location nulls last, p.sku) from internal.pick_lines p where p.session_id = s.id), '[]'::jsonb),
      'orders', coalesce((select jsonb_agg(jsonb_build_object(
          'order_id', o.id, 'order_number', o.order_number, 'status', o.status, 'position', f.position,
          'bin', b.code, 'customer', o.shipping_address ->> 'full_name', 'ship_by', o.ship_by,
          'shipping_method', o.shipping_method_name, 'carrier', o.carrier, 'tracking_number', o.tracking_number,
          'removed', f.removed_at is not null,
          'items', (select jsonb_agg(jsonb_build_object('order_item_id', oi.id, 'sku', oi.sku, 'product', oi.product_name,
                                                        'variant', oi.variant_label, 'quantity', oi.quantity,
                                                        'sorted', oi.sorted_qty, 'packed', oi.packed_qty) order by oi.sku)
                    from public.order_items oi where oi.order_id = o.id))
        order by f.position) from internal.fulfillment_session_orders f
        join public.orders o on o.id = f.order_id left join internal.bins b on b.id = f.bin_id
        where f.session_id = s.id), '[]'::jsonb),
      'exceptions', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'status', e.status, 'sku', e.sku,
          'quantity', e.quantity, 'notes', e.notes, 'order_number', (select order_number from public.orders where id = e.order_id),
          'created_at', e.created_at) order by e.created_at desc)
        from internal.fulfillment_exceptions e where e.session_id = s.id), '[]'::jsonb),
      'recent_scans', coalesce((select jsonb_agg(x.response order by x.id desc) from (
          select id, response from internal.scan_events where session_id = s.id order by id desc limit 15) x), '[]'::jsonb)
    )
    from internal.fulfillment_sessions s where s.id = p_session_id
  );
end;
$$;

-- Record what was picked for one SKU. Shortfalls and damage open exceptions.
create or replace function public.svc_pick_update(
  p_actor uuid, p_pick_line_id uuid, p_picked int, p_short int default 0, p_damaged int default 0, p_notes text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p internal.pick_lines%rowtype;
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  select * into p from internal.pick_lines where id = p_pick_line_id for update;
  if not found then raise exception 'Pick line not found'; end if;
  if p_picked < 0 or p_short < 0 or p_damaged < 0 then raise exception 'Quantities cannot be negative' using errcode = 'P0031'; end if;
  if p_picked + p_short > p.required_qty then
    raise exception 'Picked plus short (%) is more than the % required for %', p_picked + p_short, p.required_qty, p.sku using errcode = 'P0031';
  end if;

  update internal.pick_lines
     set picked_qty = p_picked, short_qty = p_short, damaged_qty = p_damaged,
         notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_by = p_actor, updated_at = now()
   where id = p_pick_line_id;

  if p_short > p.short_qty then
    insert into internal.fulfillment_exceptions (kind, session_id, variant_id, sku, quantity, notes, created_by)
    values ('short_pick', p.session_id, p.variant_id, p.sku, p_short - p.short_qty,
            coalesce(p_notes, 'Supplier did not have enough'), p_actor);
    -- Repeated shortfalls lower trust in supplier stock: mark it unavailable until re-checked.
    update internal.supplier_items set on_hand_qty = 0, last_checked_at = now()
     where variant_id = p.variant_id and is_primary;
  end if;
  if p_damaged > p.damaged_qty then
    insert into internal.fulfillment_exceptions (kind, session_id, variant_id, sku, quantity, notes, created_by)
    values ('damaged', p.session_id, p.variant_id, p.sku, p_damaged - p.damaged_qty, p_notes, p_actor);
  end if;

  -- Once this SKU is fully picked (or declared short), the units are in Giftora's hands.
  if p_picked + p_short = p.required_qty then
    perform internal.acquire_reservations(array(
      select oi.id from public.order_items oi
      join internal.fulfillment_session_orders f on f.order_id = oi.order_id and f.session_id = p.session_id and f.removed_at is null
      where oi.variant_id = p.variant_id));
  end if;

  update internal.fulfillment_sessions set status = 'sorting'
   where id = p.session_id and status = 'picking'
     and not exists (select 1 from internal.pick_lines where session_id = p.session_id and picked_qty + short_qty < required_qty);
end;
$$;

-- ---------------------------------------------------------------------------
-- Scanning
-- ---------------------------------------------------------------------------
create or replace function internal.resolve_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select variant_id from internal.variant_barcodes
   where code = btrim(p_code) or code = upper(btrim(p_code))
   order by (code = btrim(p_code)) desc
   limit 1;
$$;

-- One scanned item during sorting. Returns where it goes, or why it can't be placed.
-- Idempotent: the same key returns the first answer (a double-read never counts twice).
create or replace function public.svc_sort_scan(p_actor uuid, p_session_id uuid, p_code text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev     jsonb;
  v_variant  uuid;
  v_line     record;
  v_resp     jsonb;
  v_result   text;
  v_done     boolean;
  v_expected jsonb;
  v_vrow     record;
  v_item_id  uuid;
  v_bin_id   uuid;
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  select response into v_prev from internal.scan_events where idempotency_key = p_key;
  if v_prev is not null then return v_prev; end if;

  v_variant := internal.resolve_code(p_code);
  if v_variant is null then
    v_result := 'unknown_code';
    v_resp := jsonb_build_object('result', v_result, 'code', p_code,
                                 'message', 'This barcode isn''t linked to any product. Enter the SKU by hand or check the item.');
  else
    select v.sku, v.label, p.name as product, v.product_id into v_vrow
      from public.product_variants v join public.products p on p.id = v.product_id where v.id = v_variant;

    -- Best eligible line: earliest ship-by, then priority, then fewest left, then oldest payment.
    select oi.id, oi.order_id, oi.quantity, oi.sorted_qty, o.order_number, f.bin_id, b.code as bin
      into v_line
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      join internal.fulfillment_session_orders f on f.order_id = o.id and f.session_id = p_session_id and f.removed_at is null
      left join internal.bins b on b.id = f.bin_id
     where oi.variant_id = v_variant and oi.sorted_qty < oi.quantity and oi.status <> 'cancelled'
       and o.status in ('processing', 'ready_to_ship')
     order by o.ship_by nulls last, o.priority desc, (oi.quantity - oi.sorted_qty), o.paid_at
     limit 1
     for update of oi;

    if v_line.id is null then
      -- Is another variant of the same product still needed? Then it's the wrong variant.
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
              p_session_id, v_variant, v_vrow.sku, 1, 'Scanned during sorting', p_actor);
    else
      v_item_id := v_line.id;
      v_bin_id := v_line.bin_id;
      update public.order_items
         set sorted_qty = sorted_qty + 1,
             status = case when sorted_qty + 1 = quantity then 'sorted' else status end
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
                                   'sorted', v_line.sorted_qty + 1, 'required', v_line.quantity,
                                   'order_complete', coalesce(v_done, false));
    end if;
  end if;

  insert into internal.scan_events (session_id, kind, code, variant_id, order_item_id, bin_id, result, response, idempotency_key, actor_id)
  values (p_session_id, 'sort', p_code, v_variant, v_item_id, v_bin_id, v_result,
          v_resp || jsonb_build_object('at', now()), p_key, p_actor);
  return v_resp;
end;
$$;

-- One scanned item while packing a specific order.
create or replace function public.svc_pack_scan(p_actor uuid, p_order_id uuid, p_code text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev    jsonb;
  v_variant uuid;
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
    v_variant := internal.resolve_code(p_code);
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
    else
      v_item_id := v_line.id;
      update public.order_items
         set packed_qty = packed_qty + 1,
             status = case when packed_qty + 1 = quantity then 'packed' else status end
       where id = v_line.id;
      select bool_and(packed_qty >= quantity) into v_done from public.order_items
       where order_id = p_order_id and status <> 'cancelled';
      if v_done then
        update public.orders set status = 'packed' where id = p_order_id;
      end if;
      v_resp := jsonb_build_object('result', 'ok', 'sku', v_line.sku, 'product', v_line.product_name, 'variant', v_line.variant_label,
                                   'packed', v_line.packed_qty + 1, 'required', v_line.quantity, 'order_complete', coalesce(v_done, false));
    end if;
  end if;

  insert into internal.scan_events (session_id, kind, code, variant_id, order_item_id, result, response, idempotency_key, actor_id)
  values (v_session, 'pack', p_code, v_variant, v_item_id, v_resp ->> 'result', v_resp || jsonb_build_object('at', now()), p_key, p_actor);
  return v_resp;
end;
$$;

-- Manager override: treat an order as verified and packed without full scans. Always audited.
create or replace function public.svc_override_pack(p_actor uuid, p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_old text;
begin
  perform internal.act_as(p_actor, 'fulfillment.override');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required for an override' using errcode = 'P0032'; end if;
  select status into v_old from public.orders where id = p_order_id for update;
  if v_old not in ('processing', 'ready_to_ship') then
    raise exception 'Only orders being prepared can be overridden (this one is %)', v_old using errcode = 'P0032';
  end if;
  update public.order_items set sorted_qty = quantity, packed_qty = quantity, status = 'packed'
   where order_id = p_order_id and status <> 'cancelled';
  update public.orders set status = 'packed' where id = p_order_id;
  perform internal.write_audit('fulfillment.override', 'public.orders', p_order_id::text,
                               jsonb_build_object('status', v_old), jsonb_build_object('status', 'packed'), p_reason);
end;
$$;

-- Take an order out of a session (e.g. items unavailable). It goes back to the queue.
create or replace function public.svc_session_remove_order(p_actor uuid, p_session_id uuid, p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'orders.edit');
  update internal.fulfillment_session_orders set removed_at = now(), removed_reason = p_reason
   where session_id = p_session_id and order_id = p_order_id and removed_at is null;
  if not found then raise exception 'Order is not in this session'; end if;
  perform internal.release_bin(p_order_id);
  update public.order_items set sorted_qty = 0, packed_qty = 0, status = 'acquisition_pending'
   where order_id = p_order_id and status not in ('cancelled', 'short', 'damaged');
  update public.orders set status = 'paid' where id = p_order_id and status in ('processing', 'ready_to_ship', 'packed');
  perform internal.write_audit('session.remove_order', 'internal.fulfillment_sessions', p_session_id::text,
                               null, jsonb_build_object('order_id', p_order_id), p_reason);
end;
$$;

create or replace function public.svc_session_close(p_actor uuid, p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  if exists (select 1 from internal.fulfillment_session_orders f join public.orders o on o.id = f.order_id
              where f.session_id = p_session_id and f.removed_at is null
                and o.status not in ('shipped', 'delivered', 'cancelled')) then
    raise exception 'Ship or remove every order before closing the session' using errcode = 'P0033';
  end if;
  update internal.fulfillment_sessions set status = 'completed', completed_at = now() where id = p_session_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shipping with the label lock (replaces the version from service_api)
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

  if p_status = 'shipped' and v_in_session and v_old <> 'packed' then
    raise exception 'Label locked: scan every item at packing first (or a manager can override).' using errcode = 'P0012';
  end if;
  if not (
    (v_old = 'paid' and p_status in ('processing', 'shipped')) or
    (v_old = 'processing' and p_status = 'shipped') or
    (v_old in ('ready_to_ship', 'packed') and p_status = 'shipped') or
    (v_old = 'shipped' and p_status = 'delivered')
  ) then
    raise exception 'cannot move an order from % to %', v_old, p_status using errcode = 'P0010';
  end if;
  if p_status = 'shipped' and (coalesce(p_carrier, '') = '' or coalesce(p_tracking_number, '') = '') then
    raise exception 'carrier and tracking number are required to ship' using errcode = 'P0011';
  end if;

  update public.orders
     set status = p_status,
         carrier = coalesce(p_carrier, carrier),
         tracking_number = coalesce(p_tracking_number, tracking_number),
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
          jsonb_strip_nulls(jsonb_build_object('carrier', p_carrier, 'tracking_number', p_tracking_number,
                                               'tracking_url', p_tracking_url)),
          true, p_actor);
  perform internal.write_audit('order.status', 'public.orders', p_order_id::text,
                               jsonb_build_object('status', v_old), jsonb_build_object('status', p_status), p_note);
  if p_status = 'shipped' then
    perform internal.enqueue('order.shipped', jsonb_build_object('order_id', p_order_id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Exceptions
-- ---------------------------------------------------------------------------
create or replace function public.svc_exceptions(p_actor uuid, p_status text default 'open')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'kind', e.kind, 'status', e.status, 'sku', e.sku, 'quantity', e.quantity, 'notes', e.notes,
      'resolution', e.resolution, 'created_at', e.created_at, 'resolved_at', e.resolved_at,
      'session_id', e.session_id, 'session', s.code,
      'order_id', e.order_id, 'order_number', o.order_number,
      'product', (select p.name || ' — ' || v.label from public.product_variants v join public.products p on p.id = v.product_id where v.id = e.variant_id),
      'created_by', (select display_name from internal.staff_members where user_id = e.created_by),
      -- Orders in the same session waiting on this SKU (who is affected by a shortfall).
      'affected_orders', (select jsonb_agg(distinct o2.order_number) from public.order_items oi
                            join internal.fulfillment_session_orders f on f.order_id = oi.order_id and f.removed_at is null
                            join public.orders o2 on o2.id = oi.order_id
                           where e.session_id is not null and f.session_id = e.session_id and oi.variant_id = e.variant_id
                             and oi.sorted_qty < oi.quantity))
      order by e.created_at desc)
    from internal.fulfillment_exceptions e
    left join internal.fulfillment_sessions s on s.id = e.session_id
    left join public.orders o on o.id = e.order_id
    where p_status is null or e.status = p_status), '[]'::jsonb);
end;
$$;

create or replace function public.svc_exception_resolve(p_actor uuid, p_exception_id uuid, p_resolution text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  if coalesce(btrim(p_resolution), '') = '' then raise exception 'Describe how it was resolved' using errcode = 'P0034'; end if;
  update internal.fulfillment_exceptions
     set status = 'resolved', resolution = p_resolution, resolved_by = p_actor, resolved_at = now()
   where id = p_exception_id and status = 'open';
end;
$$;

create or replace function public.svc_exception_create(p_actor uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v uuid;
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  insert into internal.fulfillment_exceptions (kind, session_id, order_id, sku, quantity, notes, created_by)
  values (p ->> 'kind', nullif(p ->> 'session_id', '')::uuid, nullif(p ->> 'order_id', '')::uuid,
          nullif(p ->> 'sku', ''), nullif(p ->> 'quantity', '')::int, p ->> 'notes', p_actor)
  returning id into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds (the staff app calls Stripe first, then records the result here)
-- ---------------------------------------------------------------------------
create or replace function public.svc_order_payment(p_actor uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'refunds.create');
  return (
    select jsonb_build_object(
      'payment_intent_id', p.provider_payment_id, 'amount_cents', p.amount_cents, 'status', p.status,
      'refunded_cents', coalesce((select sum(amount_cents) from internal.refunds r
                                   where r.payment_id = p.id and r.status = 'succeeded'), 0),
      'order_number', o.order_number, 'order_status', o.status)
    from internal.payments p join public.orders o on o.id = p.order_id
    where p.order_id = p_order_id and p.status in ('captured', 'partially_refunded', 'refunded')
    order by p.created_at desc limit 1);
end;
$$;

create or replace function public.svc_refund_record(
  p_actor uuid, p_order_id uuid, p_amount_cents bigint, p_reason text, p_provider_refund_id text, p_cancel_order boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay      internal.payments%rowtype;
  v_refunded bigint;
begin
  perform internal.act_as(p_actor, 'refunds.create');
  select * into v_pay from internal.payments
   where order_id = p_order_id and status in ('captured', 'partially_refunded') order by created_at desc limit 1 for update;
  if not found then raise exception 'No refundable payment for this order' using errcode = 'P0040'; end if;
  select coalesce(sum(amount_cents), 0) into v_refunded from internal.refunds where payment_id = v_pay.id and status = 'succeeded';
  if p_amount_cents <= 0 or v_refunded + p_amount_cents > v_pay.amount_cents then
    raise exception 'Refund of % would exceed the % still refundable', p_amount_cents, v_pay.amount_cents - v_refunded
      using errcode = 'P0041';
  end if;

  insert into internal.refunds (payment_id, order_id, amount_cents, reason, provider_refund_id, status, created_by)
  values (v_pay.id, p_order_id, p_amount_cents, p_reason, p_provider_refund_id, 'succeeded', p_actor)
  on conflict (provider_refund_id) do nothing;
  if not found then return; end if;  -- already recorded

  insert into internal.order_adjustments (order_id, kind, amount_cents, note, created_by)
  values (p_order_id, 'refund', p_amount_cents, p_reason, p_actor);

  update internal.payments
     set status = case when v_refunded + p_amount_cents >= amount_cents then 'refunded' else 'partially_refunded' end::public.payment_status
   where id = v_pay.id;
  update public.orders
     set payment_status = case when v_refunded + p_amount_cents >= v_pay.amount_cents then 'refunded' else 'partially_refunded' end::public.payment_status
   where id = p_order_id;

  if p_cancel_order then
    update public.orders set status = 'cancelled', cancelled_at = now()
     where id = p_order_id and status in ('paid', 'processing', 'ready_to_ship', 'packed');
    update public.order_items set status = 'cancelled' where order_id = p_order_id;
    update internal.inventory_reservations r set status = 'released'
      from public.order_items oi where oi.id = r.order_item_id and oi.order_id = p_order_id and r.status in ('held', 'confirmed');
    update internal.fulfillment_session_orders set removed_at = now(), removed_reason = 'Refunded and cancelled'
     where order_id = p_order_id and removed_at is null;
    perform internal.release_bin(p_order_id);
  end if;

  insert into public.order_events (order_id, type, message, data, visible_to_customer, actor_id)
  values (p_order_id, 'refunded',
          case when p_cancel_order then 'Order cancelled and refunded' else 'Partial refund issued' end,
          jsonb_build_object('amount_cents', p_amount_cents), true, p_actor);
  perform internal.enqueue('order.refunded', jsonb_build_object('order_id', p_order_id, 'amount_cents', p_amount_cents,
                                                                'cancelled', p_cancel_order, 'reason', p_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- Bins
-- ---------------------------------------------------------------------------
create or replace function public.svc_bins(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'code', b.code, 'status', b.status,
                                                       'order_number', o.order_number) order by b.code)
                   from internal.bins b left join public.orders o on o.id = b.current_order_id), '[]'::jsonb);
end;
$$;

create or replace function public.svc_bins_add(p_actor uuid, p_count int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  if p_count < 1 or p_count > 200 then raise exception 'Add between 1 and 200 bins'; end if;
  select coalesce(max(substring(code from 5)::int), 0) into n from internal.bins;
  insert into internal.bins (code) select 'BIN-' || lpad(i::text, 3, '0') from generate_series(n + 1, n + p_count) i;
  return p_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock down every svc_ function to service_role (re-run for the new ones).
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
