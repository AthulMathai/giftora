-- Service API tests. Runs after core_rules_test.sql on the same database
-- (alice's order GFT-1001 is paid; Olivia is an order manager without finance access).
\set ON_ERROR_STOP 1
\set QUIET 1

-- An inventory manager who can see cost, and a fulfillment helper.
insert into auth.users (id, email) values
  ('44444444-4444-4444-8444-444444444444', 'ivan@giftora.ca'),
  ('55555555-5555-4555-8555-555555555555', 'fay@giftora.ca');
insert into internal.staff_members (user_id, role_key, display_name) values
  ('44444444-4444-4444-8444-444444444444', 'super_admin', 'Ivan (owner)'),
  ('55555555-5555-4555-8555-555555555555', 'fulfillment_staff', 'Fay (packing)');

-- ===========================================================================
-- Only the server (service_role) can call svc_* functions
-- ===========================================================================
set role anon;
select test.throws('select public.svc_expire_checkouts()', 'permission denied', 'anon cannot call service functions');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select test.throws('select public.svc_mark_order_paid(gen_random_uuid(), ''pi_x'', 1)', 'permission denied',
  'customer cannot mark an order paid through the service API');
select test.throws('select public.svc_staff_orders(''44444444-4444-4444-8444-444444444444'')', 'permission denied',
  'customer cannot impersonate staff through the service API');
select test.throws('select staff_note from public.orders', 'permission denied', 'customer cannot read staff notes');
select test.ok((select count(*) from public.orders where tracking_number is null) >= 1, 'customer can read tracking fields');
reset role;
select set_config('request.jwt.claim.sub', '', false);

set role service_role;
-- Stripe event idempotency
select test.ok(public.svc_record_payment_event('evt_1', 'payment_intent.succeeded', '{}'), 'first webhook event is new');
select public.svc_finish_payment_event('evt_1');
select test.ok(not public.svc_record_payment_event('evt_1', 'payment_intent.succeeded', '{}'), 'replayed event is ignored');
select test.ok(public.svc_record_payment_event('evt_2', 'payment_intent.succeeded', '{}'), 'second event is new');
select public.svc_finish_payment_event('evt_2', 'boom');
select test.ok(public.svc_record_payment_event('evt_2', 'payment_intent.succeeded', '{}'), 'a failed event can be retried');

-- Outbox
select test.ok((select count(*) from public.svc_claim_outbox(10) where topic = 'order.paid') = 1, 'worker claims the order.paid alert');
select test.ok((select count(*) from public.svc_claim_outbox(10)) = 0, 'a claimed event is not handed out twice');

-- Staff order list: finance fields depend on the actor's role
select test.ok(jsonb_array_length(public.svc_staff_orders('33333333-3333-4333-8333-333333333333')) = 1,
  'order manager sees the paid order');
select test.ok(public.svc_staff_orders('33333333-3333-4333-8333-333333333333')::text !~ 'cost|profit_cents"\s*:\s*\d',
  'order manager gets no cost or profit');
select test.ok((public.svc_staff_orders('44444444-4444-4444-8444-444444444444') -> 0 ->> 'profit_cents')::int > 0,
  'owner sees profit (after the Stripe fee)');
select test.throws('select public.svc_staff_orders(''55555555-5555-4555-8555-555555555555'')', 'orders.view',
  'fulfillment helper cannot browse orders');

-- Pick list
select test.ok((select total_qty from public.svc_pick_summary('55555555-5555-4555-8555-555555555555') where sku = 'CF-POUR-01') = 2,
  'pick list totals CF-POUR-01 across orders');
select test.ok((select orders[1] from public.svc_pick_summary('55555555-5555-4555-8555-555555555555') where sku = 'CF-POUR-01') = 'GFT-1001 ×2',
  'pick list remembers which order needs what');

-- Shipping by hand
select test.throws(format('select public.svc_update_order_status(%L, %L, ''shipped'')',
  '33333333-3333-4333-8333-333333333333', (select id from public.orders where order_number = 'GFT-1001')),
  'tracking number', 'shipping requires carrier and tracking');
select test.throws(format('select public.svc_update_order_status(%L, %L, ''delivered'')',
  '33333333-3333-4333-8333-333333333333', (select id from public.orders where order_number = 'GFT-1001')),
  'cannot move', 'cannot jump from paid to delivered');
select public.svc_update_order_status('33333333-3333-4333-8333-333333333333',
  (select id from public.orders where order_number = 'GFT-1001'), 'shipped', 'Canada Post', '7023210039414604', null, 'Packed by Olivia');
reset role;
select test.ok((select status = 'shipped' and tracking_number = '7023210039414604' from public.orders where order_number = 'GFT-1001'),
  'order is shipped with tracking');
select test.ok((select bool_and(r.status = 'acquired') from internal.inventory_reservations r
                join public.order_items oi on oi.id = r.order_item_id
                join public.orders o on o.id = oi.order_id where o.order_number = 'GFT-1001'),
  'shipping marks the reserved stock as acquired');
select test.ok(exists (select 1 from internal.outbox_events where topic = 'order.shipped'), 'shipping email queued');
select test.ok(exists (select 1 from internal.audit_logs where action = 'order.status'
                        and actor_id = '33333333-3333-4333-8333-333333333333'), 'status change audited with the staff member');
select test.ok((select count(*) from public.svc_pick_summary('55555555-5555-4555-8555-555555555555')) = 0,
  'shipped order leaves the pick list');

-- Expired holds stop blocking stock even before cleanup runs
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
delete from public.cart_items where cart_id = 'cccccccc-0000-4000-8000-000000000002';
insert into public.cart_items (cart_id, variant_id, quantity) values
  ('cccccccc-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000105', 5);
select order_number from public.start_checkout('aaaaaaaa-0000-4000-8000-000000000002', 'standard');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select test.ok(internal.available_qty('e0000000-0000-4000-8000-000000000105') = 0, 'hold blocks the stock');
update internal.inventory_reservations set expires_at = now() - interval '1 second' where status = 'held';
select test.ok(internal.available_qty('e0000000-0000-4000-8000-000000000105') = 5, 'expired hold frees stock without cleanup');

\echo 'All service API tests passed.'
