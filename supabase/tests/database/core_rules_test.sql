-- Core business-rule tests. Run on a freshly migrated + seeded database:
--   scripts/test-db.sh
-- Every check raises an exception on failure, so the run stops at the first broken rule.
\set ON_ERROR_STOP 1
\set QUIET 1

create schema if not exists test;
create or replace function test.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;
-- Runs sql as the current role and passes only if it raises an error containing `expect`.
create or replace function test.throws(sql text, expect text, msg text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL: % (no error raised)', msg;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', msg, sqlerrm;
  end if;
  raise notice 'ok - %', msg;
end $$;
grant usage on schema test to anon, authenticated, service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- Two customers and one staff member.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.com'),
  ('33333333-3333-4333-8333-333333333333', 'staff@giftora.ca');
insert into internal.staff_members (user_id, role_key, display_name)
values ('33333333-3333-4333-8333-333333333333', 'order_manager', 'Olivia (orders)');
insert into public.addresses (id, user_id, full_name, line1, city, province, postal_code) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Alice A', '1 King St W', 'Toronto', 'ON', 'M5H 1A1'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Bob B', '2 Rue Ste-Catherine', 'Montréal', 'QC', 'H2X 1L4');
insert into public.carts (id, user_id) values
  ('cccccccc-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111'),
  ('cccccccc-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222');

-- ===========================================================================
-- 1. Pricing engine
-- ===========================================================================
select test.ok(internal.compute_price(2000, 'markup', 0.10) = 2200, 'markup 10% on $20.00 = $22.00');
select test.ok(internal.compute_price(2000, 'margin', 0.10) = 2222, 'margin 10% on $20.00 = $22.22');
select test.ok(internal.compute_price(2000, 'margin', 0.10, 0, 500) = 2500, 'min profit $5 floor lifts $22.22 to $25.00');
select test.ok(internal.compute_price(2000, 'markup', 0.00, 0.20, 0) = 2500, 'min margin 20% floor = $25.00');
select test.ok(internal.compute_price(2222, 'markup', 0, 0, 0, 'charm_99') = 2299, 'charm rounding $22.22 -> $22.99');
select test.ok(internal.compute_price(2299, 'markup', 0, 0, 0, 'charm_99') = 2299, 'charm rounding keeps $22.99');
select test.ok((select price_cents from public.product_variants where sku = 'CF-POUR-01') = 3599,
  'global 10% margin on $32.00 -> $35.56 -> $35.99');
select test.ok((select price_cents from public.product_variants where sku = 'HD-BLK-M') = 3799,
  'apparel category 25% margin beats global: $28.00 -> $37.33 -> $37.99');
select test.ok((select price_cents from public.product_variants where sku = 'CND-TRIO-01') = 2199,
  '$3 minimum profit floor applies to $18.00 candle: $21.00 -> $21.99');

-- ===========================================================================
-- 2. Anonymous visitors: catalog yes, internal data never
-- ===========================================================================
set role anon;
select test.ok((select count(*) from public.products) = 5, 'anon can browse products');
select test.ok((select count(*) from public.product_variants) = 11, 'anon can see variants and prices');
select test.throws('select * from internal.supplier_items', 'permission denied', 'anon cannot read supplier items');
select test.throws('select * from internal.pricing_rules', 'permission denied', 'anon cannot read pricing rules');
select test.throws('insert into public.carts (user_id) values (''11111111-1111-4111-8111-111111111111'')',
  'permission denied', 'anon cannot create a cart (login required)');
select test.ok((select purchasable_qty from public.variant_availability(array['e0000000-0000-4000-8000-000000000201'::uuid])) = 8,
  'anon sees purchasable quantity');
select test.ok((select purchasable_qty from public.variant_availability(array['e0000000-0000-4000-8000-000000000301'::uuid])) = 10,
  'purchasable quantity is capped at 10 (supplier has 12)');
select test.throws('select internal.available_qty(''e0000000-0000-4000-8000-000000000201'')', 'permission denied',
  'anon cannot call internal functions');
reset role;

-- No column anywhere in public is a cost or supplier column.
select test.ok(not exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and (column_name ~ '(cost|supplier|profit|margin)')
), 'no public table has a cost, supplier, profit or margin column');

-- ===========================================================================
-- 3. Customers: own data only
-- ===========================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select test.ok((select count(*) from public.addresses) = 1, 'alice sees only her own address');
select test.throws('select * from internal.order_financial_snapshots', 'permission denied', 'customer cannot read snapshots');
select test.throws('select internal.mark_order_paid(gen_random_uuid(), ''pi_x'', 1)', 'permission denied',
  'customer cannot mark an order paid');
select test.throws('update public.products set name = ''hacked''', 'permission denied', 'customer cannot edit catalog');
select test.ok((select count(*) from public.my_staff_permissions()) = 0, 'customer has no staff permissions');

-- Alice adds the last white large hoodie (supplier has 1) and a coffee set.
insert into public.cart_items (cart_id, variant_id, quantity) values
  ('cccccccc-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000106', 1),
  ('cccccccc-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000201', 2);
create temp table alice_checkout as
  select * from public.start_checkout('aaaaaaaa-0000-4000-8000-000000000001', 'standard');
select test.ok((select count(*) from alice_checkout) = 1, 'alice starts checkout');
select test.ok((select order_number from alice_checkout) = 'GFT-1001', 'first order number is GFT-1001');
-- 3799 + 2*3599 = 10997 subtotal, free shipping over $75, 13% ON HST = 1430 (rounded)
select test.ok((select total_cents from alice_checkout) = 10997 + 1430, 'ON total: $109.97 + 13% HST, free shipping');
select test.ok((select count(*) from public.orders) = 1, 'alice sees her pending order');
select test.throws('update public.orders set total_cents = 1', 'permission denied', 'customer cannot edit an order');

-- Bob cannot see Alice's order, and cannot buy the hoodie Alice is holding.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select test.ok((select count(*) from public.orders) = 0, 'bob cannot see alice''s order');
insert into public.cart_items (cart_id, variant_id, quantity) values
  ('cccccccc-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000106', 1);
select test.throws('select * from public.start_checkout(''aaaaaaaa-0000-4000-8000-000000000002'', ''standard'')',
  'not enough stock for HD-WHT-L', 'no overselling: bob is blocked while alice holds the last unit');
select test.throws('select * from public.start_checkout(''aaaaaaaa-0000-4000-8000-000000000001'', ''standard'')',
  'shipping address not found', 'bob cannot check out to alice''s address');
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ===========================================================================
-- 4. Payment, snapshots, immutability
-- ===========================================================================
select test.throws(format('select internal.mark_order_paid(%L, ''pi_test_1'', 100)', (select order_id from alice_checkout)),
  'does not match', 'payment amount must match the order total');
select internal.mark_order_paid((select order_id from alice_checkout), 'pi_test_1', (select total_cents from alice_checkout), 352);
select internal.mark_order_paid((select order_id from alice_checkout), 'pi_test_1', (select total_cents from alice_checkout), 352);
select test.ok((select status = 'paid' and payment_status = 'captured' from public.orders where id = (select order_id from alice_checkout)),
  'order is paid');
select test.ok((select count(*) from internal.payments) = 1, 'webhook retry does not create a second payment');
select test.ok((select count(*) from internal.order_adjustments where kind = 'payment_fee') = 1, 'stripe fee recorded once');
select test.ok((select bool_and(status = 'confirmed') from internal.inventory_reservations), 'reservations confirmed');
select test.ok((select count(*) from public.cart_items where cart_id = 'cccccccc-0000-4000-8000-000000000001') = 0,
  'alice''s cart is emptied after payment');
select test.ok((select count(*) from internal.outbox_events where topic = 'order.paid') = 1, 'staff alert queued once');
select test.ok((select expected_profit_cents from internal.order_financial_snapshots s
                join public.order_items oi on oi.id = s.order_item_id where oi.sku = 'CF-POUR-01') = 2 * (3599 - 3200),
  'snapshot records expected profit');

select test.throws('update public.order_items set unit_price_cents = 1', 'immutable', 'order item price cannot change');
select test.throws('update internal.order_financial_snapshots set unit_cost_cents = 1', 'immutable', 'cost snapshot cannot change');
select test.throws('delete from public.order_items', 'cannot be deleted', 'order items cannot be deleted');

-- A global margin change reprices the catalog but never past orders.
select set_config('giftora.actor_id', '33333333-3333-4333-8333-333333333333', false);
select set_config('giftora.reason', 'Raise margin for Q4', false);
update internal.pricing_rules set rate = 0.20 where scope = 'global';
select set_config('giftora.reason', '', false);
select test.ok((select price_cents from public.product_variants where sku = 'CF-POUR-01') = 4099,
  'global 20% margin reprices the catalog: $32.00 -> $40.00 -> $40.99');
select test.ok((select unit_price_cents from public.order_items where sku = 'CF-POUR-01') = 3599,
  'existing order keeps its $35.99 price');
select test.ok(exists (select 1 from internal.audit_logs where object_type = 'internal.pricing_rules'
                       and action = 'update' and actor_id = '33333333-3333-4333-8333-333333333333'
                       and reason = 'Raise margin for Q4'
                       and old_value ->> 'rate' = '0.1000' and new_value ->> 'rate' = '0.2000'),
  'margin change is audited with actor, reason, old and new value');
select test.ok(exists (select 1 from internal.price_history ph join public.product_variants v on v.id = ph.variant_id
                       where v.sku = 'CF-POUR-01' and ph.old_price_cents = 3599 and ph.new_price_cents = 4099),
  'price history records the change');
select test.throws('update internal.audit_logs set reason = ''x''', 'append-only', 'audit log cannot be edited');
select test.throws('delete from internal.audit_logs', 'append-only', 'audit log cannot be deleted');

-- Alerts: finance fields only when asked for.
select test.ok(not (internal.order_alert_payload((select order_id from alice_checkout), false)::text ~ 'cost|profit'),
  'non-finance staff alert has no cost or profit');
select test.ok((internal.order_alert_payload((select order_id from alice_checkout), true) -> 'items' -> 0 ->> 'sku') is not null
               and (internal.order_alert_payload((select order_id from alice_checkout), true) ->> 'expected_profit_cents') is not null,
  'finance staff alert includes SKU and expected profit');

-- ===========================================================================
-- 5. Expired checkouts release their stock
-- ===========================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
delete from public.cart_items where cart_id = 'cccccccc-0000-4000-8000-000000000002';
insert into public.cart_items (cart_id, variant_id, quantity) values
  ('cccccccc-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000501', 4);
create temp table bob_checkout as
  select * from public.start_checkout('aaaaaaaa-0000-4000-8000-000000000002', 'express');
-- QC: GST 5% only (not QST-registered). 4 x TH-KNIT price + $24.99 express
select test.ok((select o.tax_breakdown ->> 'gst' is not null and o.tax_breakdown ->> 'hst' is null
                from public.orders o where o.id = (select order_id from bob_checkout)),
  'QC order charges GST only');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select test.ok(internal.available_qty('e0000000-0000-4000-8000-000000000501') = 0, 'bob holds all 4 blankets');
update public.orders set checkout_expires_at = now() - interval '1 minute' where id = (select order_id from bob_checkout);
select test.ok(internal.expire_checkouts() = 1, 'expired checkout is cancelled');
select test.ok(internal.available_qty('e0000000-0000-4000-8000-000000000501') = 4, 'blankets are available again');

-- ===========================================================================
-- 6. Staff permissions
-- ===========================================================================
select test.ok(internal.has_permission('33333333-3333-4333-8333-333333333333', 'fulfillment.override'),
  'order manager can override fulfillment locks');
select test.ok(not internal.has_permission('33333333-3333-4333-8333-333333333333', 'finance.view'),
  'order manager cannot see cost or profit');
select test.ok(not internal.has_permission('11111111-1111-4111-8111-111111111111', 'orders.view'),
  'customers have no staff permissions');

\echo
\echo 'All core rule tests passed.'
