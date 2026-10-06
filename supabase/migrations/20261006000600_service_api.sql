-- Service API: the only doorway from server code into `internal`.
--
-- The `internal` schema is never exposed through the Supabase API, so server code (Stripe webhook,
-- notification worker, staff app) reaches it through these `public.svc_*` functions. They are
-- executable ONLY by service_role: customers and anonymous visitors get "permission denied".
-- Staff functions take the acting staff member's id, check their permission, and record them
-- as the actor in the audit log.

-- Manual shipping fields for the lean launch (carrier labels come later).
alter table public.orders
  add column carrier          text,
  add column tracking_number  text,
  add column tracking_url     text,
  add column shipped_at       timestamptz,
  add column delivered_at     timestamptz,
  add column staff_note       text;

-- Customers must not see staff notes.
revoke select on public.orders from authenticated;
grant select (id, order_number, user_id, status, payment_status, email, shipping_address,
              shipping_method, shipping_method_name, subtotal_cents, discount_cents, shipping_cents,
              tax_cents, total_cents, currency, tax_breakdown, ship_by, checkout_expires_at,
              placed_at, paid_at, cancelled_at, created_at, updated_at,
              carrier, tracking_number, tracking_url, shipped_at, delivered_at)
  on public.orders to authenticated;

-- Expired holds stop counting immediately, even before the cleanup job releases them.
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
    where r.variant_id = p_variant_id
      and (r.status = 'confirmed' or (r.status = 'held' and (r.expires_at is null or r.expires_at > now())))
  )
  select greatest(0, supply.qty - claimed.qty)::int from supply, claimed;
$$;

-- Helper: fail unless the actor holds the permission; then record them for auditing.
create or replace function internal.act_as(p_actor uuid, p_permission text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null or not internal.has_permission(p_actor, p_permission) then
    raise exception 'permission % required', p_permission using errcode = '42501';
  end if;
  perform set_config('giftora.actor_id', p_actor::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Stripe
-- ---------------------------------------------------------------------------

-- Returns true the first time an event id is seen, false on a retry.
create or replace function public.svc_record_payment_event(p_event_id text, p_type text, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into internal.payment_events (provider_event_id, type, payload)
  values (p_event_id, p_type, p_payload);
  return true;
exception when unique_violation then
  return (select processed_at is null from internal.payment_events where provider_event_id = p_event_id);
end;
$$;

create or replace function public.svc_finish_payment_event(p_event_id text, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update internal.payment_events
     set processed_at = case when p_error is null then now() end, error = p_error
   where provider_event_id = p_event_id;
$$;

-- What the server needs to create a PaymentIntent for a customer's pending order.
create or replace function public.svc_order_for_payment(p_order_id uuid, p_user_id uuid)
returns table (order_id uuid, order_number text, total_cents bigint, email text, status public.order_status,
               checkout_expires_at timestamptz, payment_intent_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, o.total_cents, o.email::text, o.status, o.checkout_expires_at,
         (select p.provider_payment_id from internal.payments p
           where p.order_id = o.id and p.status in ('pending', 'authorized')
           order by p.created_at desc limit 1)
  from public.orders o
  where o.id = p_order_id and o.user_id = p_user_id;
$$;

create or replace function public.svc_attach_payment_intent(p_order_id uuid, p_payment_intent_id text, p_amount_cents bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into internal.payments (order_id, provider_payment_id, status, amount_cents)
  values (p_order_id, p_payment_intent_id, 'pending', p_amount_cents)
  on conflict (provider_payment_id) do nothing;
$$;

create or replace function public.svc_mark_order_paid(
  p_order_id uuid, p_payment_intent_id text, p_amount_cents bigint, p_fee_cents bigint default null
) returns void
language sql
security definer
set search_path = ''
as $$
  select internal.mark_order_paid(p_order_id, p_payment_intent_id, p_amount_cents, p_fee_cents);
$$;

create or replace function public.svc_mark_payment_failed(p_payment_intent_id text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
begin
  update internal.payments set status = 'failed', risk = risk || jsonb_build_object('failure', p_reason)
   where provider_payment_id = p_payment_intent_id and status <> 'captured'
   returning order_id into v_order;
  if v_order is not null then
    insert into public.order_events (order_id, type, message, data, visible_to_customer)
    values (v_order, 'payment_failed', 'Payment attempt failed', jsonb_build_object('reason', p_reason), false);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Background jobs
-- ---------------------------------------------------------------------------
create or replace function public.svc_expire_checkouts()
returns int
language sql
security definer
set search_path = ''
as $$ select internal.expire_checkouts(); $$;

create or replace function public.svc_claim_outbox(p_limit int default 20)
returns table (id bigint, topic text, payload jsonb, attempts int)
language sql
security definer
set search_path = ''
as $$
  select e.id, e.topic, e.payload, e.attempts from internal.claim_outbox(p_limit) e;
$$;

create or replace function public.svc_complete_outbox(p_id bigint, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update internal.outbox_events
     set processed_at = case when p_error is null then now() end,
         last_error = p_error
   where id = p_id;
$$;

create or replace function public.svc_get_setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select value from internal.system_settings where key = p_key; $$;

-- Alert payload; finance fields only when asked for (callers decide per recipient).
create or replace function public.svc_order_alert(p_order_id uuid, p_include_finance boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select internal.order_alert_payload(p_order_id, p_include_finance); $$;

-- ---------------------------------------------------------------------------
-- Staff: orders and the consolidated pick list (manual fulfillment for launch)
-- ---------------------------------------------------------------------------
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

-- Everything paid but not yet acquired, totalled per SKU, in aisle order: the supplier trip list.
create or replace function public.svc_pick_summary(p_actor uuid)
returns table (sku text, product text, variant text, aisle text, supplier text,
               total_qty bigint, orders text[])
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'fulfillment.operate');
  return query
    select oi.sku, oi.product_name, oi.variant_label, si.aisle_location, sup.name,
           sum(oi.quantity)::bigint,
           array_agg(o.order_number || ' ×' || oi.quantity order by o.paid_at)
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      left join internal.inventory_reservations r on r.order_item_id = oi.id
      left join internal.supplier_items si on si.id = r.supplier_item_id
      left join internal.suppliers sup on sup.id = si.supplier_id
     where o.status in ('paid', 'processing') and oi.status = 'acquisition_pending'
     group by oi.sku, oi.product_name, oi.variant_label, si.aisle_location, sup.name
     order by si.aisle_location nulls last, oi.sku;
end;
$$;

-- Manual status changes for launch week: processing, shipped (with tracking), delivered.
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
begin
  perform internal.act_as(p_actor, 'orders.edit');
  select status into v_old from public.orders where id = p_order_id for update;
  if v_old is null then raise exception 'order not found'; end if;

  if not (
    (v_old = 'paid' and p_status in ('processing', 'shipped')) or
    (v_old = 'processing' and p_status in ('shipped')) or
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
    -- Items are physically in hand once an order is processed or shipped by hand.
    update public.order_items set status = 'acquired'
     where order_id = p_order_id and status = 'acquisition_pending';
    update internal.inventory_reservations r set status = 'acquired'
      from public.order_items oi where oi.id = r.order_item_id and oi.order_id = p_order_id
       and r.status = 'confirmed';
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

create or replace function public.svc_order_tracking(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object('carrier', carrier, 'tracking_number', tracking_number,
                                              'tracking_url', tracking_url))
  from public.orders where id = p_order_id;
$$;

-- ---------------------------------------------------------------------------
-- Lock down: service_role only.
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

-- ---------------------------------------------------------------------------
-- Release unpaid checkout holds every minute (pg_cron is available on Supabase).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('giftora-expire-checkouts', '* * * * *', 'select internal.expire_checkouts()');
    exception when others then
      -- Never block the migration on the scheduler; the storefront also expires holds on its own.
      raise notice 'pg_cron setup skipped: %', sqlerrm;
    end;
  else
    raise notice 'pg_cron not available; run svc_expire_checkouts() from a scheduler instead';
  end if;
end $$;
