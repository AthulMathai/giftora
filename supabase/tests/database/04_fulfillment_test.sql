-- Fulfillment Center tests: a full session from picking to shipping, plus refunds.
-- Runs after 03_catalog_admin_test.sql. Actors: Ivan (super admin), Olivia (order manager),
-- Fay (fulfillment staff).
\set ON_ERROR_STOP 1
\set QUIET 1

create temp table f (k text primary key, v uuid);
grant all on f to service_role, authenticated;

-- Two customers, each places and pays for an order today.
insert into auth.users (id, email) values
  ('77777777-7777-4777-8777-777777777777', 'carol@example.com'),
  ('88888888-8888-4888-8888-888888888888', 'dave@example.com');
insert into public.addresses (id, user_id, full_name, line1, city, province, postal_code) values
  ('aaaaaaaa-0000-4000-8000-000000000007', '77777777-7777-4777-8777-777777777777', 'Carol C', '7 Bay St', 'Toronto', 'ON', 'M5J 2R8'),
  ('aaaaaaaa-0000-4000-8000-000000000008', '88888888-8888-4888-8888-888888888888', 'Dave D', '8 Main St', 'Halifax', 'NS', 'B3H 1A1');
insert into public.carts (id, user_id) values
  ('cccccccc-0000-4000-8000-000000000007', '77777777-7777-4777-8777-777777777777'),
  ('cccccccc-0000-4000-8000-000000000008', '88888888-8888-4888-8888-888888888888');
insert into public.cart_items (cart_id, variant_id, quantity) values
  ('cccccccc-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000102', 2),  -- HD-BLK-M x2
  ('cccccccc-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000201', 1),  -- CF-POUR-01 x1
  ('cccccccc-0000-4000-8000-000000000008', 'e0000000-0000-4000-8000-000000000102', 1),  -- HD-BLK-M x1
  ('cccccccc-0000-4000-8000-000000000008', 'e0000000-0000-4000-8000-000000000103', 1);  -- HD-BLK-L x1

set role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', false);
insert into f select 'A', order_id from public.start_checkout('aaaaaaaa-0000-4000-8000-000000000007', 'standard');
select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888888', false);
insert into f select 'B', order_id from public.start_checkout('aaaaaaaa-0000-4000-8000-000000000008', 'standard');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select internal.mark_order_paid((select v from f where k = 'A'), 'pi_A', (select total_cents from public.orders where id = (select v from f where k = 'A')));
select pg_sleep(0.01);
select internal.mark_order_paid((select v from f where k = 'B'), 'pi_B', (select total_cents from public.orders where id = (select v from f where k = 'B')));

set role service_role;
-- ===========================================================================
-- Volume and session creation
-- ===========================================================================
select test.ok((select (d ->> 'waiting')::int from jsonb_array_elements(public.svc_fulfillment_volume(
  '55555555-5555-4555-8555-555555555555', internal.local_date(now()), internal.local_date(now()))) d) = 2,
  'daily volume shows 2 orders waiting today');

insert into f select 'S', public.svc_session_create('55555555-5555-4555-8555-555555555555',
  internal.local_date(now()), internal.local_date(now()), 'Morning run');
select test.ok((select status from public.orders where id = (select v from f where k = 'A')) = 'processing', 'orders move to processing');
select test.throws(format('select public.svc_session_create(%L, %L, %L)', '55555555-5555-4555-8555-555555555555',
  internal.local_date(now()), internal.local_date(now())), 'No paid orders', 'orders are never in two sessions');

select test.ok((select b.code from internal.fulfillment_session_orders x join internal.bins b on b.id = x.bin_id
                where x.order_id = (select v from f where k = 'A')) = 'BIN-001', 'first order gets BIN-001');
select test.ok((select b.code from internal.fulfillment_session_orders x join internal.bins b on b.id = x.bin_id
                where x.order_id = (select v from f where k = 'B')) = 'BIN-002', 'second order gets BIN-002');
select test.ok((select required_qty from internal.pick_lines where session_id = (select v from f where k = 'S') and sku = 'HD-BLK-M') = 3,
  'pick list combines HD-BLK-M across orders (2 + 1 = 3)');
select test.ok((select count(*) from internal.pick_lines where session_id = (select v from f where k = 'S')) = 3, 'three SKUs to pick');

-- ===========================================================================
-- Picking
-- ===========================================================================
select test.throws(format('select public.svc_pick_update(%L, %L, 5)', '55555555-5555-4555-8555-555555555555',
  (select id from internal.pick_lines where session_id = (select v from f where k = 'S') and sku = 'HD-BLK-M')),
  'more than the 3 required', 'cannot pick more than required');
select public.svc_pick_update('55555555-5555-4555-8555-555555555555',
  (select id from internal.pick_lines where session_id = (select v from f where k = 'S') and sku = 'HD-BLK-M'), 3);
select public.svc_pick_update('55555555-5555-4555-8555-555555555555',
  (select id from internal.pick_lines where session_id = (select v from f where k = 'S') and sku = 'CF-POUR-01'), 1);
select public.svc_pick_update('55555555-5555-4555-8555-555555555555',
  (select id from internal.pick_lines where session_id = (select v from f where k = 'S') and sku = 'HD-BLK-L'), 0, 1, 0, 'Shelf empty');
select test.ok((select on_hand_qty from internal.supplier_items where variant_id = 'e0000000-0000-4000-8000-000000000102') = 3,
  'picking 3 HD-BLK-M takes them off the supplier shelf count (6 -> 3)');
select test.ok(internal.available_qty('e0000000-0000-4000-8000-000000000102') = 3,
  'acquired units are not double-counted: 3 left to sell');
select test.ok(exists (select 1 from internal.fulfillment_exceptions where kind = 'short_pick' and sku = 'HD-BLK-L'),
  'short pick opens an exception');
select test.ok((select on_hand_qty from internal.supplier_items where variant_id = 'e0000000-0000-4000-8000-000000000103') = 0,
  'short pick zeroes supplier stock so it stops selling');
select test.ok((select status from internal.fulfillment_sessions where id = (select v from f where k = 'S')) = 'sorting',
  'session moves to sorting when every line is picked or short');

-- ===========================================================================
-- Scan-to-sort
-- ===========================================================================
create temp table r (k text primary key, v jsonb);
grant all on r to service_role;
insert into r select 's1', public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from f where k = 'S'), 'HD-BLK-M', 'k1');
select test.ok((select v ->> 'result' from r where k = 's1') = 'ok', 'scan finds an order');
select test.ok((select v ->> 'order_number' from r where k = 's1') = (select order_number from public.orders where id = (select v from f where k = 'B')),
  'allocation prefers the order closest to completion (B needs just 1)');
select test.ok((select v ->> 'bin' from r where k = 's1') = 'BIN-002', 'scan shows the bin');
insert into r select 's1again', public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from f where k = 'S'), 'HD-BLK-M', 'k1');
select test.ok((select sorted_qty from public.order_items where order_id = (select v from f where k = 'B') and sku = 'HD-BLK-M') = 1,
  'a repeated scan (same key) is not counted twice');

insert into r select 's2', public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from f where k = 'S'), '0628000000028', 'k2');
select test.ok((select v ->> 'bin' = 'BIN-001' and v ->> 'sorted' = '1' and v ->> 'required' = '2' from r where k = 's2'),
  'supplier barcode works: BIN-001, 1 of 2');

insert into r select 's3', public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from f where k = 'S'), 'HD-BLK-S', 'k3');
select test.ok((select v ->> 'result' from r where k = 's3') = 'wrong_variant', 'wrong size is blocked as WRONG VARIANT');
select test.ok((select v ->> 'message' from r where k = 's3') like '%Small / Black%', 'message names the scanned variant');

insert into r select 's4', public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from f where k = 'S'), 'WL-BRN', 'k4');
select test.ok((select v ->> 'result' from r where k = 's4') = 'not_required', 'unneeded item is ITEM NOT REQUIRED');
select test.ok(exists (select 1 from internal.fulfillment_exceptions where kind = 'unexpected_item' and sku = 'WL-BRN'),
  'unneeded item opens an exception');
insert into r select 's5', public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from f where k = 'S'), 'NOPE-123', 'k5');
select test.ok((select v ->> 'result' from r where k = 's5') = 'unknown_code', 'unknown barcode is reported');

select public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from f where k = 'S'), 'HD-BLK-M', 'k6');
insert into r select 's7', public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from f where k = 'S'), 'CF-POUR-01', 'k7');
select test.ok((select (v ->> 'order_complete')::boolean from r where k = 's7'), 'last item completes order A');
select test.ok((select status from public.orders where id = (select v from f where k = 'A')) = 'ready_to_ship', 'order A is ready to ship');
insert into r select 's8', public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from f where k = 'S'), 'HD-BLK-M', 'k8');
select test.ok((select v ->> 'result' from r where k = 's8') <> 'ok'
               and (select sum(sorted_qty) from public.order_items oi join internal.fulfillment_session_orders x on x.order_id = oi.order_id
                    where x.session_id = (select v from f where k = 'S') and oi.sku = 'HD-BLK-M') = 3,
  'never over-allocates: a 4th HD-BLK-M is refused (B still needs a Large, so it says wrong variant)');

-- ===========================================================================
-- Label lock, packing, shipping
-- ===========================================================================
select test.throws(format('select public.svc_update_order_status(%L, %L, ''shipped'', ''Canada Post'', ''123'')',
  '33333333-3333-4333-8333-333333333333', (select v from f where k = 'A')), 'Label locked', 'shipping is locked before packing');

insert into r select 'p1', public.svc_pack_scan('55555555-5555-4555-8555-555555555555', (select v from f where k = 'A'), 'WL-BRN', 'p1');
select test.ok((select v ->> 'result' from r where k = 'p1') = 'not_in_order', 'packing blocks an item not in the order');
select public.svc_pack_scan('55555555-5555-4555-8555-555555555555', (select v from f where k = 'A'), 'HD-BLK-M', 'p2');
select public.svc_pack_scan('55555555-5555-4555-8555-555555555555', (select v from f where k = 'A'), 'HD-BLK-M', 'p3');
insert into r select 'p4', public.svc_pack_scan('55555555-5555-4555-8555-555555555555', (select v from f where k = 'A'), 'HD-BLK-M', 'p4');
select test.ok((select v ->> 'result' from r where k = 'p4') = 'already_packed', 'packing blocks an extra unit');
insert into r select 'p5', public.svc_pack_scan('55555555-5555-4555-8555-555555555555', (select v from f where k = 'A'), 'CF-POUR-01', 'p5');
select test.ok((select (v ->> 'order_complete')::boolean from r where k = 'p5'), 'expected = scanned: order A is packed');
select test.ok((select status from public.orders where id = (select v from f where k = 'A')) = 'packed', 'status is packed');

select public.svc_update_order_status('33333333-3333-4333-8333-333333333333', (select v from f where k = 'A'),
  'shipped', 'Canada Post', '7023210039414605');
select test.ok((select status from internal.bins where code = 'BIN-001') = 'available', 'shipping frees the bin for reuse');
select test.ok((select released_at is not null from internal.bin_assignments b join internal.bins x on x.id = b.bin_id
                where x.code = 'BIN-001' order by b.id desc limit 1), 'bin history keeps the assignment');

-- ===========================================================================
-- Overrides and permissions
-- ===========================================================================
select test.throws(format('select public.svc_override_pack(%L, %L, ''x'')', '55555555-5555-4555-8555-555555555555',
  (select v from f where k = 'B')), 'fulfillment.override', 'fulfillment staff cannot override');
select test.throws(format('select public.svc_override_pack(%L, %L, '''')', '33333333-3333-4333-8333-333333333333',
  (select v from f where k = 'B')), 'reason is required', 'an override needs a reason');
select test.throws(format('select public.svc_session_close(%L, %L)', '55555555-5555-4555-8555-555555555555',
  (select v from f where k = 'S')), 'Ship or remove', 'cannot close a session with unshipped orders');

-- ===========================================================================
-- Refunds: order B can't be completed (HD-BLK-L short). Take it out and refund it.
-- ===========================================================================
select public.svc_session_remove_order('33333333-3333-4333-8333-333333333333', (select v from f where k = 'S'),
  (select v from f where k = 'B'), 'Large out of stock');
select test.ok((select status from public.orders where id = (select v from f where k = 'B')) = 'paid', 'removed order returns to the queue');
select test.ok((select status from internal.bins where code = 'BIN-002') = 'available', 'removed order frees its bin');

select test.throws(format('select public.svc_refund_record(%L, %L, 1, ''x'', ''re_x'', false)', '55555555-5555-4555-8555-555555555555',
  (select v from f where k = 'B')), 'refunds.create', 'fulfillment staff cannot refund');
select test.throws(format('select public.svc_refund_record(%L, %L, 999999, ''x'', ''re_x'', false)', '44444444-4444-4444-8444-444444444444',
  (select v from f where k = 'B')), 'exceed', 'cannot refund more than was paid');
select public.svc_refund_record('44444444-4444-4444-8444-444444444444', (select v from f where k = 'B'), 1000, 'Partial goodwill', 're_1', false);
select public.svc_refund_record('44444444-4444-4444-8444-444444444444', (select v from f where k = 'B'), 1000, 'Partial goodwill', 're_1', false);
select test.ok((select count(*) from internal.refunds where provider_refund_id = 're_1') = 1, 'the same Stripe refund is recorded once');
select test.ok((select payment_status from public.orders where id = (select v from f where k = 'B')) = 'partially_refunded', 'payment partially refunded');
select public.svc_refund_record('44444444-4444-4444-8444-444444444444', (select v from f where k = 'B'),
  (select total_cents - 1000 from public.orders where id = (select v from f where k = 'B')), 'Item unavailable', 're_2', true);
select test.ok((select status = 'cancelled' and payment_status = 'refunded' from public.orders where id = (select v from f where k = 'B')),
  'full refund with cancel: order cancelled and refunded');
select test.ok(not exists (select 1 from internal.inventory_reservations r join public.order_items oi on oi.id = r.order_item_id
                where oi.order_id = (select v from f where k = 'B') and r.status in ('held', 'confirmed')),
  'cancelled order no longer blocks any stock');
select test.ok((select sum(amount_cents) from internal.order_adjustments where order_id = (select v from f where k = 'B') and kind = 'refund')
               = (select total_cents from public.orders where id = (select v from f where k = 'B')), 'refunds reduce profit by the full amount');
select test.ok((select count(*) from internal.outbox_events where topic = 'order.refunded') = 2, 'customer refund emails queued');

select public.svc_session_close('55555555-5555-4555-8555-555555555555', (select v from f where k = 'S'));
select test.ok((select status from internal.fulfillment_sessions where id = (select v from f where k = 'S')) = 'completed', 'session closes');

-- Exceptions
select test.ok(jsonb_array_length(public.svc_exceptions('55555555-5555-4555-8555-555555555555', 'open')) = 4,
  'four open exceptions: short pick, wrong variant, unexpected item x2');
select public.svc_exception_resolve('55555555-5555-4555-8555-555555555555',
  (select id from internal.fulfillment_exceptions where kind = 'short_pick' limit 1), 'Refunded order B');
select test.ok(jsonb_array_length(public.svc_exceptions('55555555-5555-4555-8555-555555555555', 'open')) = 3, 'resolving removes it from the open list');
reset role;

\echo 'All fulfillment tests passed.'
