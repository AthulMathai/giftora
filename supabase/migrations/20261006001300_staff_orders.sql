-- Staff-created orders: customers who reach Giftora by phone, in person, Instagram/Facebook,
-- email or a marketplace. Staff enter the order; it reserves supplier stock exactly like a web
-- checkout, is paid by cash / e-transfer / card terminal (now or later), and then flows into
-- batches, labels and shipping like any other order.

alter table public.orders
  add column source         text not null default 'web'
                            check (source in ('web', 'phone', 'in_person', 'social', 'email', 'marketplace', 'other')),
  add column created_by     uuid references auth.users (id),
  add column payment_method text check (payment_method in ('stripe', 'cash', 'etransfer', 'card_terminal', 'cheque', 'other'));
-- Offline customers may have no account (and sometimes no email).
alter table public.orders alter column user_id drop not null;
alter table public.orders alter column email drop not null;
alter table public.orders add constraint web_orders_have_customer
  check (source <> 'web' or (user_id is not null and email is not null));
update public.orders set payment_method = 'stripe' where source = 'web' and payment_status <> 'pending';
create index orders_source_idx on public.orders (source, paid_at);

alter table internal.payments add column reference text;

-- Same as before, except only web orders clear the customer's cart: a phone order for a
-- customer who also has an account must not empty their online cart.
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
    v_late := true;
    update public.order_items set status = 'reserved' where order_id = p_order_id;
    update internal.inventory_reservations r set status = 'held'
      from public.order_items oi where oi.id = r.order_item_id and oi.order_id = p_order_id;
  end if;

  insert into internal.payments (order_id, provider_payment_id, status, amount_cents, fee_cents)
  values (p_order_id, p_provider_payment_id, 'captured', p_amount_cents, p_fee_cents)
  on conflict (provider_payment_id) do update set status = 'captured', fee_cents = excluded.fee_cents;

  if p_fee_cents is not null and p_fee_cents > 0 then
    insert into internal.order_adjustments (order_id, kind, amount_cents, note)
    values (p_order_id, 'payment_fee', p_fee_cents,
            case when v_order.source = 'web' then 'Stripe processing fee' else 'Payment processing fee' end);
  end if;

  update internal.inventory_reservations r set status = 'confirmed', expires_at = null
    from public.order_items oi where oi.id = r.order_item_id and oi.order_id = p_order_id;
  update public.order_items set status = 'acquisition_pending' where order_id = p_order_id;
  update public.orders
     set status = 'paid', payment_status = 'captured', paid_at = now(),
         checkout_expires_at = null, cancelled_at = null,
         payment_method = coalesce(payment_method, 'stripe')
   where id = p_order_id;

  if v_order.source = 'web' then
    delete from public.cart_items ci using public.carts c
     where c.id = ci.cart_id and c.user_id = v_order.user_id;
  end if;

  insert into public.order_events (order_id, type, message, visible_to_customer)
  values (p_order_id, 'paid', 'Payment received — we''re getting your gift ready', true);

  perform internal.enqueue('order.paid', jsonb_build_object('order_id', p_order_id, 'late_payment', v_late));
  if v_late then
    perform internal.enqueue('order.paid_after_expiry', jsonb_build_object('order_id', p_order_id));
  end if;
end;
$$;

-- Prices, shipping and tax for a list of {variant_id, quantity}. Used for the live quote on the
-- staff order screen and again (inside the locked transaction) when the order is created.
create or replace function internal.staff_order_totals(
  p_items jsonb, p_shipping_method text, p_province text, p_discount_cents bigint
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lines    jsonb := '[]'::jsonb;
  v_subtotal bigint := 0;
  v_shipping bigint := 0;
  v_method   jsonb;
  v_name     text;
  v_tax      internal.tax_rules%rowtype;
  v_taxable  bigint;
  v_gst bigint; v_hst bigint; v_pst bigint;
  v_discount bigint := greatest(coalesce(p_discount_cents, 0), 0);
  r record;
begin
  for r in
    select v.id, v.sku, v.label, v.price_cents, p.name as product_name, p.status,
           sum((i ->> 'quantity')::int) as qty
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
      join public.product_variants v on v.id = (i ->> 'variant_id')::uuid
      join public.products p on p.id = v.product_id
     group by v.id, v.sku, v.label, v.price_cents, p.name, p.status
     order by v.sku
  loop
    if r.qty is null or r.qty < 1 then
      raise exception 'Quantity for % must be at least 1', r.sku using errcode = 'P0021';
    end if;
    if r.price_cents is null then
      raise exception '% has no price yet', r.sku using errcode = 'P0004';
    end if;
    v_lines := v_lines || jsonb_build_object(
      'variant_id', r.id, 'sku', r.sku, 'product', r.product_name, 'variant', r.label,
      'quantity', r.qty, 'unit_price_cents', r.price_cents, 'line_total_cents', r.price_cents * r.qty,
      'status', r.status, 'available', least(internal.available_qty(r.id), 999));
    v_subtotal := v_subtotal + r.price_cents * r.qty;
  end loop;

  if p_shipping_method = 'pickup' then
    v_name := 'Local pickup';
  else
    select m into v_method
      from internal.system_settings s, jsonb_array_elements(s.value) m
     where s.key = 'shipping.methods' and m ->> 'code' = p_shipping_method;
    if v_method is null then
      raise exception 'unknown shipping method %', p_shipping_method using errcode = 'P0003';
    end if;
    v_name := v_method ->> 'name';
    v_shipping := (v_method ->> 'cents')::bigint;
    if (v_method ->> 'free_over_cents') is not null and v_subtotal >= (v_method ->> 'free_over_cents')::bigint then
      v_shipping := 0;
    end if;
  end if;

  v_discount := least(v_discount, v_subtotal);
  select * into v_tax from internal.tax_rules where province = upper(p_province);
  v_taxable := v_subtotal - v_discount + case when coalesce(v_tax.tax_shipping, true) then v_shipping else 0 end;
  v_gst := round(v_taxable * coalesce(v_tax.gst_rate, 0));
  v_hst := round(v_taxable * coalesce(v_tax.hst_rate, 0));
  v_pst := round(v_taxable * coalesce(v_tax.pst_rate, 0));

  return jsonb_build_object(
    'lines', v_lines, 'subtotal_cents', v_subtotal, 'discount_cents', v_discount,
    'shipping_cents', v_shipping, 'shipping_method_name', v_name,
    'tax_cents', v_gst + v_hst + v_pst,
    'tax_breakdown', jsonb_strip_nulls(jsonb_build_object('province', upper(p_province),
                       'gst', nullif(v_gst, 0), 'hst', nullif(v_hst, 0), 'pst', nullif(v_pst, 0))),
    'total_cents', v_subtotal - v_discount + v_shipping + v_gst + v_hst + v_pst);
end;
$$;

create or replace function public.svc_staff_order_quote(p_actor uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'orders.edit');
  return internal.staff_order_totals(p -> 'items', coalesce(p ->> 'shipping_method', 'standard'),
                                     coalesce(p -> 'shipping_address' ->> 'province', 'ON'),
                                     coalesce((p ->> 'discount_cents')::bigint, 0));
end;
$$;

-- Variant finder for the staff order screen: name, SKU or barcode.
create or replace function public.svc_order_variant_search(p_actor uuid, p_q text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_q, ''));
begin
  perform internal.act_as(p_actor, 'orders.edit');
  if length(v_q) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'product', x ->> 'sku')
      from (
        select jsonb_build_object('variant_id', v.id, 'sku', v.sku, 'product', p.name, 'variant', v.label,
                                  'price_cents', v.price_cents, 'status', p.status,
                                  'available', least(internal.available_qty(v.id), 999)) as x
          from public.product_variants v
          join public.products p on p.id = v.product_id
         where v.is_active and p.status in ('active', 'seasonal', 'out_of_stock', 'acquisition_unavailable')
           and (p.name ilike '%' || v_q || '%' or v.sku ilike v_q || '%'
                or exists (select 1 from internal.variant_barcodes b where b.variant_id = v.id and b.code = v_q))
         limit 25
      ) s
  ), '[]'::jsonb);
end;
$$;

create or replace function internal.record_manual_payment(
  p_order_id uuid, p_method text, p_reference text, p_fee_cents bigint
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_pid   text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if p_method not in ('cash', 'etransfer', 'card_terminal', 'cheque', 'other') then
    raise exception 'Choose how the customer paid' using errcode = 'P0022';
  end if;
  v_pid := 'manual:' || v_order.order_number;
  insert into internal.payments (order_id, provider, provider_payment_id, status, amount_cents, reference)
  values (p_order_id, p_method, v_pid, 'pending', v_order.total_cents, nullif(btrim(p_reference), ''))
  on conflict (provider_payment_id) do update set provider = excluded.provider, reference = excluded.reference;
  update public.orders set payment_method = p_method where id = p_order_id;
  perform internal.mark_order_paid(p_order_id, v_pid, v_order.total_cents, p_fee_cents);
end;
$$;

-- p = { source, email?, phone?, note?, shipping_method ('standard'|'express'|'pickup'),
--       shipping_address {full_name, line1, line2?, city, province, postal_code, phone?},
--       items [{variant_id, quantity}], discount_cents?, ship_by?,
--       payment {status 'paid'|'unpaid', method, reference?, fee_cents?} }
create or replace function public.svc_staff_order_create(p_actor uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source  text := coalesce(nullif(p ->> 'source', ''), 'phone');
  v_email   extensions.citext := nullif(lower(btrim(p ->> 'email')), '');
  v_addr    jsonb := p -> 'shipping_address';
  v_method  text := coalesce(nullif(p ->> 'shipping_method', ''), 'standard');
  v_user    uuid;
  v_quote   jsonb;
  v_line    jsonb;
  v_order   uuid;
  v_number  text;
  v_si      record;
  v_rule    record;
  v_oi      uuid;
  v_days    int;
  v_paid    boolean := coalesce(p -> 'payment' ->> 'status', 'paid') = 'paid';
begin
  perform internal.act_as(p_actor, 'orders.edit');
  if v_source = 'web' then
    raise exception 'Web orders come from the store checkout' using errcode = 'P0023';
  end if;
  if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception 'Add at least one item' using errcode = 'P0001';
  end if;
  if coalesce(btrim(v_addr ->> 'full_name'), '') = '' then
    raise exception 'Enter the customer''s name' using errcode = 'P0024';
  end if;
  if v_method <> 'pickup' and (coalesce(btrim(v_addr ->> 'line1'), '') = '' or coalesce(btrim(v_addr ->> 'city'), '') = ''
                               or coalesce(btrim(v_addr ->> 'postal_code'), '') = '') then
    raise exception 'Enter the full shipping address' using errcode = 'P0024';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address doesn''t look right' using errcode = 'P0024';
  end if;

  -- If the customer already has a Giftora account, the order shows up in it.
  if v_email is not null then
    select id into v_user from public.profiles where email = v_email;
  end if;

  -- Lock supplier rows in a stable order (same as web checkout) so stock can't be double-sold.
  perform 1 from internal.supplier_items si
   where si.is_primary
     and si.variant_id in (select (i ->> 'variant_id')::uuid from jsonb_array_elements(p -> 'items') i)
   order by si.id
   for update of si;

  v_quote := internal.staff_order_totals(p -> 'items', v_method, coalesce(v_addr ->> 'province', 'ON'),
                                         coalesce((p ->> 'discount_cents')::bigint, 0));

  select (value #>> '{}')::int into v_days from internal.system_settings where key = 'orders.ship_within_days';
  v_number := coalesce((select value #>> '{}' from internal.system_settings where key = 'orders.number_prefix'), 'GFT-')
              || nextval('public.order_number_seq');

  insert into public.orders (order_number, user_id, email, shipping_address, shipping_method, shipping_method_name,
                             subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents, tax_breakdown,
                             ship_by, source, created_by, staff_note)
  values (v_number, v_user, v_email,
          jsonb_strip_nulls(jsonb_build_object(
            'full_name', btrim(v_addr ->> 'full_name'), 'line1', nullif(btrim(v_addr ->> 'line1'), ''),
            'line2', nullif(btrim(v_addr ->> 'line2'), ''), 'city', nullif(btrim(v_addr ->> 'city'), ''),
            'province', upper(coalesce(v_addr ->> 'province', 'ON')),
            'postal_code', nullif(upper(btrim(v_addr ->> 'postal_code')), ''), 'country', 'CA',
            'phone', coalesce(nullif(btrim(v_addr ->> 'phone'), ''), nullif(btrim(p ->> 'phone'), '')))),
          v_method, v_quote ->> 'shipping_method_name',
          (v_quote ->> 'subtotal_cents')::bigint, (v_quote ->> 'discount_cents')::bigint,
          (v_quote ->> 'shipping_cents')::bigint, (v_quote ->> 'tax_cents')::bigint, (v_quote ->> 'total_cents')::bigint,
          v_quote -> 'tax_breakdown',
          coalesce(nullif(p ->> 'ship_by', '')::date, (current_date + make_interval(days => coalesce(v_days, 3)))::date),
          v_source, p_actor, nullif(btrim(p ->> 'note'), ''))
  returning id into v_order;

  for v_line in select * from jsonb_array_elements(v_quote -> 'lines') loop
    if v_line ->> 'status' not in ('active', 'seasonal') then
      raise exception '% is not for sale right now', v_line ->> 'sku' using errcode = 'P0004';
    end if;
    select si.id, si.supplier_id, si.cost_cents into v_si
      from internal.supplier_items si where si.variant_id = (v_line ->> 'variant_id')::uuid and si.is_primary;
    if v_si.id is null or internal.available_qty((v_line ->> 'variant_id')::uuid) < (v_line ->> 'quantity')::int then
      raise exception 'Not enough stock for % (% available)', v_line ->> 'sku',
        least(internal.available_qty((v_line ->> 'variant_id')::uuid), 999) using errcode = 'P0005';
    end if;
    select * into v_rule from internal.effective_pricing((v_line ->> 'variant_id')::uuid);

    insert into public.order_items (order_id, variant_id, product_name, sku, variant_label, quantity,
                                    unit_price_cents, line_total_cents)
    values (v_order, (v_line ->> 'variant_id')::uuid, v_line ->> 'product', v_line ->> 'sku', v_line ->> 'variant',
            (v_line ->> 'quantity')::int, (v_line ->> 'unit_price_cents')::bigint, (v_line ->> 'line_total_cents')::bigint)
    returning id into v_oi;

    insert into internal.order_financial_snapshots (order_item_id, order_id, supplier_id, supplier_item_id,
           unit_cost_cents, pricing_rule_id, pricing_rule_type, pricing_rate, expected_profit_cents)
    values (v_oi, v_order, v_si.supplier_id, v_si.id, v_si.cost_cents, v_rule.rule_id, v_rule.rule_type, v_rule.rate,
            (v_line ->> 'line_total_cents')::bigint - v_si.cost_cents * (v_line ->> 'quantity')::int);

    -- No expiry: an unpaid phone order keeps its stock until staff mark it paid or cancel it.
    insert into internal.inventory_reservations (variant_id, supplier_item_id, order_item_id, quantity, status, expires_at)
    values ((v_line ->> 'variant_id')::uuid, v_si.id, v_oi, (v_line ->> 'quantity')::int, 'held', null);
  end loop;

  -- An order-level discount reduces profit; record it so profit reports stay right.
  if (v_quote ->> 'discount_cents')::bigint > 0 then
    insert into internal.order_adjustments (order_id, kind, amount_cents, note, created_by)
    values (v_order, 'other', (v_quote ->> 'discount_cents')::bigint, 'Order discount', p_actor);
  end if;

  insert into public.order_events (order_id, type, message, visible_to_customer, actor_id)
  values (v_order, 'placed', 'Order placed with the Giftora team', true, p_actor);

  if v_paid then
    perform internal.record_manual_payment(v_order, p -> 'payment' ->> 'method', p -> 'payment' ->> 'reference',
                                           nullif(p -> 'payment' ->> 'fee_cents', '')::bigint);
  end if;

  return jsonb_build_object('order_id', v_order, 'order_number', v_number,
                            'total_cents', (v_quote ->> 'total_cents')::bigint,
                            'status', (select status from public.orders where id = v_order),
                            'linked_account', v_user is not null);
end;
$$;

create or replace function public.svc_staff_order_mark_paid(
  p_actor uuid, p_order_id uuid, p_method text, p_reference text default null, p_fee_cents bigint default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  perform internal.act_as(p_actor, 'orders.edit');
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.source = 'web' then
    raise exception 'Only staff-created orders can be marked paid here' using errcode = 'P0023';
  end if;
  if v_order.status <> 'pending_payment' then
    raise exception 'This order isn''t waiting for payment' using errcode = 'P0023';
  end if;
  perform internal.record_manual_payment(p_order_id, p_method, p_reference, p_fee_cents);
end;
$$;

create or replace function public.svc_staff_order_cancel(p_actor uuid, p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'orders.edit');
  if not exists (select 1 from public.orders where id = p_order_id and source <> 'web' and status = 'pending_payment') then
    raise exception 'Only unpaid staff-created orders can be cancelled here' using errcode = 'P0023';
  end if;
  perform internal.cancel_pending_order(p_order_id, coalesce(nullif(btrim(p_reason), ''), 'Cancelled by staff'));
end;
$$;

-- Payment details for the refund screen, now with the payment method.
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
      'payment_intent_id', p.provider_payment_id, 'provider', p.provider, 'reference', p.reference,
      'amount_cents', p.amount_cents, 'status', p.status,
      'refunded_cents', coalesce((select sum(r.amount_cents) from internal.refunds r
                                   where r.payment_id = p.id and r.status = 'succeeded'), 0),
      'order_number', o.order_number, 'order_status', o.status)
      from internal.payments p join public.orders o on o.id = p.order_id
     where p.order_id = p_order_id and p.status in ('captured', 'partially_refunded', 'refunded')
     order by p.created_at desc
     limit 1);
end;
$$;

-- Staff order list: adds source and payment method, and shows unpaid staff orders.
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
      select o.id, o.order_number, o.status, o.payment_status, o.email, o.source, o.payment_method,
             o.shipping_address ->> 'full_name' as customer,
             o.shipping_address, o.shipping_method, o.shipping_method_name, o.total_cents, o.ship_by,
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
      where (p_statuses is null and ((o.status <> 'pending_payment' and o.status <> 'cancelled')
                                     or (o.status = 'pending_payment' and o.source <> 'web')))
         or o.status = any(p_statuses)
      order by o.paid_at nulls last, o.placed_at
      limit p_limit
    ) x
  ), '[]'::jsonb);
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
