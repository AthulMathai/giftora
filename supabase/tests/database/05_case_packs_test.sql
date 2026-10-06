-- Case packs: candle trio comes in inners of 6 and outers of 12.
-- Customer E orders 6 (a whole inner), F orders 1, G orders 2.
\set ON_ERROR_STOP 1
\set QUIET 1

create temp table cp (k text primary key, v uuid);
create temp table cr (k text primary key, v jsonb);
grant all on cp, cr to service_role, authenticated;

set role service_role;
select public.svc_variant_save('44444444-4444-4444-8444-444444444444', jsonb_build_object(
  'id', 'e0000000-0000-4000-8000-000000000301', 'product_id', 'd0000000-0000-4000-8000-000000000003',
  'sku', 'CND-TRIO-01', 'label', 'Default', 'cost_cents', 1800, 'on_hand_qty', 30,
  'inner_qty', 6, 'inner_barcode', 'INNER-CND6', 'outer_qty', 12, 'outer_barcode', 'OUTER-CND12'));
select test.ok((select pack_qty from internal.variant_barcodes where code = 'INNER-CND6') = 6, 'inner barcode counts as 6');
select test.ok((select pack_qty from internal.variant_barcodes where code = 'OUTER-CND12') = 12, 'outer barcode counts as 12');
select test.ok((public.svc_variant_packs('44444444-4444-4444-8444-444444444444', 'd0000000-0000-4000-8000-000000000003')
                 -> 'e0000000-0000-4000-8000-000000000301' ->> 'inner_qty')::int = 6, 'editor reads pack sizes back');
select test.ok(internal.pack_breakdown(6, 6, 12) = '{"outers":0,"inners":1,"singles":0,"inner_qty":6,"outer_qty":12}'::jsonb, '4 + 2 = 6 picks as 1 inner');
select test.ok((internal.pack_breakdown(12, 6, 12) ->> 'outers')::int = 1 and (internal.pack_breakdown(12, 6, 12) ->> 'inners')::int = 0, '12 picks as 1 outer');
select test.ok(internal.pack_breakdown(19, 6, 12) @> '{"outers":1,"inners":1,"singles":1}', '19 = 1 outer + 1 inner + 1 single');
select test.ok(internal.pack_breakdown(5, null, null) @> '{"outers":0,"inners":0,"singles":5}', 'items without packs pick as singles');
reset role;

-- Three customers order today
insert into auth.users (id, email) values
  ('99999999-0000-4000-8000-00000000000e', 'erin@example.com'),
  ('99999999-0000-4000-8000-00000000000f', 'finn@example.com'),
  ('99999999-0000-4000-8000-000000000010', 'gale@example.com');
insert into public.addresses (id, user_id, full_name, line1, city, province, postal_code)
select ('aaaaaaaa-0000-4000-8000-0000000000' || x.s)::uuid, x.u::uuid, x.n, '1 Main St', 'Ottawa', 'ON', 'K1P 1A1'
from (values ('0e', '99999999-0000-4000-8000-00000000000e', 'Erin'),
             ('0f', '99999999-0000-4000-8000-00000000000f', 'Finn'),
             ('10', '99999999-0000-4000-8000-000000000010', 'Gale')) x(s, u, n);
insert into public.carts (id, user_id)
select ('cccccccc-0000-4000-8000-0000000000' || x.s)::uuid, x.u::uuid
from (values ('0e', '99999999-0000-4000-8000-00000000000e'), ('0f', '99999999-0000-4000-8000-00000000000f'),
             ('10', '99999999-0000-4000-8000-000000000010')) x(s, u);
insert into public.cart_items (cart_id, variant_id, quantity) values
  ('cccccccc-0000-4000-8000-00000000000e', 'e0000000-0000-4000-8000-000000000301', 6),
  ('cccccccc-0000-4000-8000-00000000000f', 'e0000000-0000-4000-8000-000000000301', 1),
  ('cccccccc-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000301', 2);

set role authenticated;
select set_config('request.jwt.claim.sub', '99999999-0000-4000-8000-00000000000e', false);
insert into cp select 'E', order_id from public.start_checkout('aaaaaaaa-0000-4000-8000-00000000000e', 'standard');
select set_config('request.jwt.claim.sub', '99999999-0000-4000-8000-00000000000f', false);
insert into cp select 'F', order_id from public.start_checkout('aaaaaaaa-0000-4000-8000-00000000000f', 'standard');
select set_config('request.jwt.claim.sub', '99999999-0000-4000-8000-000000000010', false);
insert into cp select 'G', order_id from public.start_checkout('aaaaaaaa-0000-4000-8000-000000000010', 'standard');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select internal.mark_order_paid(v, 'pi_' || k, (select total_cents from public.orders where id = v)) from cp where k in ('E', 'F', 'G');

set role service_role;
insert into cp select 'S', public.svc_session_create('55555555-5555-4555-8555-555555555555',
  internal.local_date(now()), internal.local_date(now()), 'Pack test');
select test.ok((public.svc_pick_packs('55555555-5555-4555-8555-555555555555', (select v from cp where k = 'S'))
                 -> (select id::text from internal.pick_lines where session_id = (select v from cp where k = 'S') and sku = 'CND-TRIO-01'))
               @> '{"inners":1,"singles":3}', 'pick list asks for 1 inner + 3 singles (6 + 1 + 2 = 9)');
select public.svc_pick_update('55555555-5555-4555-8555-555555555555',
  (select id from internal.pick_lines where session_id = (select v from cp where k = 'S') and sku = 'CND-TRIO-01'), 9);

-- Sorting
insert into cr select 'a', public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from cp where k = 'S'), 'CND-TRIO-01', 'cp1');
select test.ok((select v ->> 'order_number' from cr where k = 'a') = (select order_number from public.orders where id = (select v from cp where k = 'F')),
  'a single goes to Finn (1), not Erin, whose 6 is a whole inner');
insert into cr select 'b', public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from cp where k = 'S'), 'INNER-CND6', 'cp2');
select test.ok((select v ->> 'order_number' from cr where k = 'b') = (select order_number from public.orders where id = (select v from cp where k = 'E')),
  'the unopened inner goes whole to Erin');
select test.ok((select (v ->> 'sorted')::int = 6 and (v ->> 'order_complete')::boolean from cr where k = 'b'), 'Erin is 6/6 complete in one scan');
insert into cr select 'c', public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from cp where k = 'S'), 'CND-TRIO-01', 'cp3');
select test.ok((select v ->> 'order_number' from cr where k = 'c') = (select order_number from public.orders where id = (select v from cp where k = 'G')),
  'next single goes to Gale');
insert into cr select 'd', public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from cp where k = 'S'), 'INNER-CND6', 'cp4');
select test.ok((select v ->> 'result' from cr where k = 'd') = 'open_pack', 'an inner nobody can take whole says OPEN THIS INNER');
select test.ok((select sorted_qty from public.order_items where order_id = (select v from cp where k = 'G')) = 1, 'nothing assigned until it is opened');
select public.svc_sort_scan('55555555-5555-4555-8555-555555555555', (select v from cp where k = 'S'), 'CND-TRIO-01', 'cp5');
select test.ok((select status from public.orders where id = (select v from cp where k = 'G')) = 'ready_to_ship', 'Gale complete after the opened item');

-- Packing Erin's order with the inner barcode
insert into cr select 'p', public.svc_pack_scan('55555555-5555-4555-8555-555555555555', (select v from cp where k = 'E'), 'INNER-CND6', 'cpp1');
select test.ok((select (v ->> 'order_complete')::boolean from cr where k = 'p'), 'scanning the inner verifies all 6 at packing');
insert into cr select 'q', public.svc_pack_scan('55555555-5555-4555-8555-555555555555', (select v from cp where k = 'G'), 'INNER-CND6', 'cpp2');
select test.ok((select v ->> 'result' from cr where k = 'q') = 'open_pack', 'a pack bigger than the order is refused at packing');
reset role;

\echo 'All case pack tests passed.'
