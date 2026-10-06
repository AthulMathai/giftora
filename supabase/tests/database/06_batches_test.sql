-- Simple batches: start, got-everything pick, sort, label, ship the batch.
\set ON_ERROR_STOP 1
\set QUIET 1

create temp table bt (k text primary key, v uuid);
create temp table bj (k text primary key, v jsonb);
grant all on bt, bj to service_role, authenticated;

-- Two fresh orders today: H (2 wallets) and I (1 blanket)
insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-000000000011', 'hana@example.com'),
  ('99999999-0000-4000-8000-000000000012', 'ivan2@example.com');
insert into public.addresses (id, user_id, full_name, line1, city, province, postal_code) values
  ('aaaaaaaa-0000-4000-8000-000000000011', '99999999-0000-4000-8000-000000000011', 'Hana H', '11 Queen St', 'Toronto', 'ON', 'M5C 1R6'),
  ('aaaaaaaa-0000-4000-8000-000000000012', '99999999-0000-4000-8000-000000000012', 'Ivan I', '12 King St', 'Calgary', 'AB', 'T2P 1J9');
insert into public.carts (id, user_id) values
  ('cccccccc-0000-4000-8000-000000000011', '99999999-0000-4000-8000-000000000011'),
  ('cccccccc-0000-4000-8000-000000000012', '99999999-0000-4000-8000-000000000012');
insert into public.cart_items (cart_id, variant_id, quantity) values
  ('cccccccc-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000402', 2),
  ('cccccccc-0000-4000-8000-000000000012', 'e0000000-0000-4000-8000-000000000501', 1);
set role authenticated;
select set_config('request.jwt.claim.sub', '99999999-0000-4000-8000-000000000011', false);
insert into bt select 'H', order_id from public.start_checkout('aaaaaaaa-0000-4000-8000-000000000011', 'standard');
select set_config('request.jwt.claim.sub', '99999999-0000-4000-8000-000000000012', false);
insert into bt select 'I', order_id from public.start_checkout('aaaaaaaa-0000-4000-8000-000000000012', 'standard');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select internal.mark_order_paid(v, 'pi_' || k || '_b', (select total_cents from public.orders where id = v)) from bt where k in ('H', 'I');

set role service_role;
insert into bt select 'S', public.svc_session_create('55555555-5555-4555-8555-555555555555',
  internal.local_date(now()) - 30, internal.local_date(now()), null);
select test.ok((select code from internal.fulfillment_sessions where id = (select v from bt where k = 'S'))
               ~ ('^B-' || to_char(now() at time zone 'America/Toronto', 'YYMMDD') || '-[0-9]{2}$'),
  'batch number looks like B-YYMMDD-NN');
select test.ok((select code from internal.fulfillment_sessions where id = (select v from bt where k = 'S'))
               <> (select code from internal.fulfillment_sessions where id <> (select v from bt where k = 'S') order by created_at desc limit 1),
  'each batch gets its own number');
select test.ok((select batch from jsonb_to_recordset(public.svc_staff_orders('44444444-4444-4444-8444-444444444444')) as x(order_number text, batch text)
                where order_number = (select order_number from public.orders where id = (select v from bt where k = 'H')))
               = (select code from internal.fulfillment_sessions where id = (select v from bt where k = 'S')),
  'the order list shows each order''s batch number');

select test.ok(public.svc_pick_all('55555555-5555-4555-8555-555555555555', (select v from bt where k = 'S')) = 2,
  '"Got everything" marks both lines picked');
select test.ok((select status from internal.fulfillment_sessions where id = (select v from bt where k = 'S')) = 'sorting', 'batch moves to sorting');

select test.throws(format('select public.svc_label_printed(%L, %L)', '55555555-5555-4555-8555-555555555555', (select v from bt where k = 'H')),
  'not complete', 'no label before the bin is complete');

select public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from bt where k = 'S'), 'WL-BLK', 'b1');
insert into bj select 'h', public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from bt where k = 'S'), 'WL-BLK', 'b2');
select test.ok((select (v ->> 'order_complete')::boolean and v ->> 'order_id' is not null from bj where k = 'h'),
  'completing a bin returns the order id so its label can print at once');
insert into bj select 'lab', public.svc_label_data('55555555-5555-4555-8555-555555555555', (select v from bt where k = 'H'));
select test.ok((select v ->> 'batch' is not null and v ->> 'bin' is not null and (v -> 'ship_to' ->> 'full_name') = 'Hana H'
                       and (v ->> 'units')::int = 2 from bj where k = 'lab'),
  'label data: ship-to, batch, bin and unit count');
select test.ok(public.svc_label_printed('55555555-5555-4555-8555-555555555555', (select v from bt where k = 'H')) = 1, 'first print');
select test.ok((select status from public.orders where id = (select v from bt where k = 'H')) = 'packed', 'a printed label marks the order packed — no second scan');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '99999999-0000-4000-8000-000000000011', false);
select test.ok((select status from public.orders where id = (select v from bt where k = 'H')) = 'packed'
               and exists (select 1 from public.order_events where order_id = (select v from bt where k = 'H')
                           and type = 'packed' and message = 'Packed and ready for the carrier'),
  'the customer sees "Packed" on their tracking screen');
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select test.ok(public.svc_label_printed('55555555-5555-4555-8555-555555555555', (select v from bt where k = 'H')) = 2, 'reprint counted');
select test.ok((select count(*) from public.order_events where order_id = (select v from bt where k = 'H') and type = 'packed') = 1,
  'a reprint does not repeat the customer update');
select test.ok(exists (select 1 from internal.audit_logs where action = 'label.reprint'), 'reprints are audited');

select public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from bt where k = 'S'), 'TH-KNIT-GRY', 'b3');
select public.svc_label_printed('55555555-5555-4555-8555-555555555555', (select v from bt where k = 'I'));

select test.ok(public.svc_batch_ship('33333333-3333-4333-8333-333333333333', (select v from bt where k = 'S'), 'Canada Post') = 2,
  'one step ships the whole batch (tracking optional)');
select test.ok((select bool_and(status = 'shipped') from public.orders where id in (select v from bt where k in ('H', 'I'))), 'both orders shipped');
select test.ok((select status from internal.fulfillment_sessions where id = (select v from bt where k = 'S')) = 'completed', 'batch closes itself');
select test.ok((select count(*) from internal.bins where current_order_id in (select v from bt where k in ('H', 'I'))) = 0, 'bins are free again');
reset role;

\echo 'All batch tests passed.'
