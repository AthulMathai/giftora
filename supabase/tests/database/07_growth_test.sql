-- Seasonal campaigns, search, staff-created orders, analytics and the SEO checklist.
\set ON_ERROR_STOP 1
\set QUIET 1

create temp table gt (k text primary key, v uuid);
create temp table gj (k text primary key, v jsonb);
grant all on gt, gj to service_role, authenticated, anon;

-- ---------------------------------------------------------------- campaigns
set role service_role;
insert into gt select 'C', public.svc_campaign_save('44444444-4444-4444-8444-444444444444', jsonb_build_object(
  'slug', 'test-winter', 'name', 'Winter test', 'theme', 'winter', 'occasion', 'housewarming',
  'headline', 'Warm up', 'early_from', now() - interval '1 day', 'starts_at', now() + interval '5 days',
  'ends_at', now() + interval '20 days', 'is_published', false, 'accent_color', '#123456'));
select test.throws(format('select public.svc_campaigns(%L)', '55555555-5555-4555-8555-555555555555'),
  'marketing.edit', 'packing staff can''t edit campaigns');
insert into gj select 'c', public.svc_campaign_get('44444444-4444-4444-8444-444444444444', (select v from gt where k = 'C'));
select test.ok((select v ->> 'phase' from gj where k = 'c') = 'early', 'a season before its start but after early_from is in "shop early"');
select test.ok((select (v ->> 'product_count')::int from gj where k = 'c') = 2, 'products join a season by occasion tag');
select public.svc_campaign_products_set('44444444-4444-4444-8444-444444444444', (select v from gt where k = 'C'),
  array['d0000000-0000-4000-8000-000000000004'::uuid]);
select test.ok((public.svc_campaign_get('44444444-4444-4444-8444-444444444444', (select v from gt where k = 'C')) ->> 'product_count')::int = 3,
  'hand-picked products add to the occasion matches');
select test.throws(format('select public.svc_campaign_save(%L, %L::jsonb)', '44444444-4444-4444-8444-444444444444',
  '{"slug":"bad","name":"Bad","headline":"x","starts_at":"2027-01-02","ends_at":"2027-01-01"}'),
  'campaign_dates', 'a season can''t end before it starts');
reset role;

set role anon;
select test.ok(not exists (select 1 from public.campaigns where slug = 'test-winter'), 'unpublished seasons are hidden from the store');
select test.ok(exists (select 1 from public.campaigns where slug = 'christmas'), 'published seasons are public');
select test.ok(not exists (select 1 from public.campaign_products cp join public.campaigns c on c.id = cp.campaign_id where c.slug = 'test-winter'),
  'picks of an unpublished season are hidden');
select test.throws('update public.campaigns set name = ''x''', 'permission denied', 'visitors can''t change seasons');
-- ---------------------------------------------------------------- search
select test.ok(exists (select 1 from public.search_products('cofee') s join public.products p on p.id = s.product_id
                        where p.slug = 'pour-over-coffee-set'), 'search tolerates typos ("cofee")');
select test.ok((select count(*) from public.search_products('candle')) >= 1
               and (select p.slug from public.search_products('candle') s join public.products p on p.id = s.product_id order by s.rank desc limit 1) = 'soy-candle-trio',
  'the best match ranks first');
select test.ok(not exists (select 1 from public.search_products('')), 'an empty search returns nothing');
reset role;

-- ---------------------------------------------------------------- staff-created orders
-- An existing customer with a cart: a phone order for them must not empty it.
insert into auth.users (id, email) values ('99999999-0000-4000-8000-000000000021', 'paula@example.com');
insert into public.carts (id, user_id) values ('cccccccc-0000-4000-8000-000000000021', '99999999-0000-4000-8000-000000000021');
insert into public.cart_items (cart_id, variant_id, quantity) values ('cccccccc-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000201', 1);
insert into gj select 'avail0', to_jsonb(internal.available_qty('e0000000-0000-4000-8000-000000000301'));

set role service_role;
insert into gj select 'q', public.svc_staff_order_quote('44444444-4444-4444-8444-444444444444', jsonb_build_object(
  'items', jsonb_build_array(jsonb_build_object('variant_id', 'e0000000-0000-4000-8000-000000000301', 'quantity', 2)),
  'shipping_method', 'standard', 'shipping_address', jsonb_build_object('province', 'ON'), 'discount_cents', 500));
select test.ok((select (v ->> 'total_cents')::bigint = (v ->> 'subtotal_cents')::bigint - 500 + (v ->> 'shipping_cents')::bigint + (v ->> 'tax_cents')::bigint
                from gj where k = 'q'), 'the quote adds up, discount included');
select test.ok((select (v ->> 'tax_cents')::bigint = round(((v ->> 'subtotal_cents')::bigint - 500 + (v ->> 'shipping_cents')::bigint) * 0.13)
                from gj where k = 'q'), 'Ontario HST is on the discounted subtotal plus shipping');

select test.throws(format('select public.svc_staff_order_create(%L, %L::jsonb)', '55555555-5555-4555-8555-555555555555',
  '{"source":"phone","items":[{"variant_id":"e0000000-0000-4000-8000-000000000301","quantity":1}],"shipping_address":{"full_name":"X","line1":"1 A","city":"B","province":"ON","postal_code":"M1M 1M1"}}'),
  'orders.edit', 'packing staff can''t create orders');
select test.throws(format('select public.svc_staff_order_create(%L, %L::jsonb)', '44444444-4444-4444-8444-444444444444',
  '{"source":"web","items":[{"variant_id":"e0000000-0000-4000-8000-000000000301","quantity":1}],"shipping_address":{"full_name":"X"}}'),
  'store checkout', 'staff can''t fake a web order');
select test.throws(format('select public.svc_staff_order_create(%L, %L::jsonb)', '44444444-4444-4444-8444-444444444444',
  '{"source":"phone","items":[{"variant_id":"e0000000-0000-4000-8000-000000000301","quantity":500}],"shipping_address":{"full_name":"X","line1":"1 A","city":"B","province":"ON","postal_code":"M1M 1M1"},"payment":{"status":"paid","method":"cash"}}'),
  'Not enough stock', 'staff orders can''t oversell either');

-- Paid by cash, for the existing customer (matched by email).
insert into gj select 'paid', public.svc_staff_order_create('44444444-4444-4444-8444-444444444444', jsonb_build_object(
  'source', 'phone', 'email', 'Paula@Example.com', 'shipping_method', 'standard', 'discount_cents', 500,
  'shipping_address', jsonb_build_object('full_name', 'Paula P', 'line1', '21 Bay St', 'city', 'Toronto', 'province', 'ON', 'postal_code', 'm5j 2n8'),
  'items', jsonb_build_array(jsonb_build_object('variant_id', 'e0000000-0000-4000-8000-000000000301', 'quantity', 2)),
  'payment', jsonb_build_object('status', 'paid', 'method', 'cash', 'reference', 'Till 1')));
insert into gt select 'P', (v ->> 'order_id')::uuid from gj where k = 'paid';
select test.ok((select status = 'paid' and payment_status = 'captured' and source = 'phone' and payment_method = 'cash'
                       and user_id = '99999999-0000-4000-8000-000000000021' and shipping_address ->> 'postal_code' = 'M5J 2N8'
                  from public.orders where id = (select v from gt where k = 'P')),
  'a cash phone order is paid, linked to the customer''s account by email');
select test.ok((select provider = 'cash' and reference = 'Till 1' from internal.payments where order_id = (select v from gt where k = 'P')),
  'the payment records the method and reference');
select test.ok(exists (select 1 from public.cart_items where cart_id = 'cccccccc-0000-4000-8000-000000000021'),
  'their online cart is left alone');
select test.ok(internal.available_qty('e0000000-0000-4000-8000-000000000301') = (select (v #>> '{}')::int from gj where k = 'avail0') - 2,
  'the order claims supplier stock');
select test.ok(exists (select 1 from internal.outbox_events where topic = 'order.paid' and payload ->> 'order_id' = (select v::text from gt where k = 'P')),
  'staff alert and customer email are queued like a web order');
select test.ok(exists (select 1 from public.svc_staff_orders('44444444-4444-4444-8444-444444444444') x
                         cross join jsonb_array_elements(x) o
                        where o ->> 'id' = (select v::text from gt where k = 'P') and o ->> 'source' = 'phone'
                          and (o ->> 'profit_cents')::bigint = (select sum(expected_profit_cents) from internal.order_financial_snapshots
                                                                  where order_id = (select v from gt where k = 'P')) - 500),
  'the order list shows the source, and profit is net of the discount');

-- Unpaid (waiting on an e-transfer), no email.
insert into gj select 'unpaid', public.svc_staff_order_create('44444444-4444-4444-8444-444444444444', jsonb_build_object(
  'source', 'social', 'shipping_method', 'express',
  'shipping_address', jsonb_build_object('full_name', 'Insta Ian', 'line1', '5 Main St', 'city', 'Halifax', 'province', 'NS', 'postal_code', 'B3H 1A1'),
  'items', jsonb_build_array(jsonb_build_object('variant_id', 'e0000000-0000-4000-8000-000000000301', 'quantity', 1)),
  'payment', jsonb_build_object('status', 'unpaid')));
insert into gt select 'U', (v ->> 'order_id')::uuid from gj where k = 'unpaid';
select test.ok((select status = 'pending_payment' and email is null and user_id is null and checkout_expires_at is null
                  from public.orders where id = (select v from gt where k = 'U')),
  'an unpaid staff order waits, with no email and no account');
select internal.expire_checkouts();
select test.ok((select status from public.orders where id = (select v from gt where k = 'U')) = 'pending_payment',
  'the checkout timer never cancels it');
select test.ok(internal.available_qty('e0000000-0000-4000-8000-000000000301') = (select (v #>> '{}')::int from gj where k = 'avail0') - 3,
  'and its stock stays held');
select test.ok(exists (select 1 from jsonb_array_elements(public.svc_staff_orders('44444444-4444-4444-8444-444444444444')) o
                        where o ->> 'id' = (select v::text from gt where k = 'U')),
  'unpaid staff orders show in the order list');
select public.svc_staff_order_mark_paid('44444444-4444-4444-8444-444444444444', (select v from gt where k = 'U'), 'etransfer', 'ref 8812');
select test.ok((select status = 'paid' and payment_method = 'etransfer' from public.orders where id = (select v from gt where k = 'U')),
  'marking it paid moves it into fulfillment');
select test.throws(format('select public.svc_staff_order_mark_paid(%L, %L, %L)', '44444444-4444-4444-8444-444444444444',
  (select v from gt where k = 'U'), 'cash'), 'waiting for payment', 'it can''t be paid twice');

-- Cancel an unpaid one: stock comes back.
insert into gt select 'X', (public.svc_staff_order_create('44444444-4444-4444-8444-444444444444', jsonb_build_object(
  'source', 'in_person', 'shipping_method', 'pickup', 'shipping_address', jsonb_build_object('full_name', 'Walk In', 'province', 'ON'),
  'items', jsonb_build_array(jsonb_build_object('variant_id', 'e0000000-0000-4000-8000-000000000301', 'quantity', 1)),
  'payment', jsonb_build_object('status', 'unpaid'))) ->> 'order_id')::uuid;
select test.ok((select shipping_cents = 0 and shipping_method_name = 'Local pickup' from public.orders where id = (select v from gt where k = 'X')),
  'local pickup has no shipping charge or address');
select public.svc_staff_order_cancel('44444444-4444-4444-8444-444444444444', (select v from gt where k = 'X'), 'Changed mind');
select test.ok(internal.available_qty('e0000000-0000-4000-8000-000000000301') = (select (v #>> '{}')::int from gj where k = 'avail0') - 3,
  'cancelling an unpaid order releases its stock');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '99999999-0000-4000-8000-000000000021', false);
select test.ok(exists (select 1 from public.orders where id = (select v from gt where k = 'P')),
  'the customer sees the phone order in their account');
select test.ok(not exists (select 1 from public.orders where id = (select v from gt where k = 'U')),
  'but not anyone else''s');
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------- analytics
set role service_role;
select test.ok(public.svc_track(jsonb_build_array(
  jsonb_build_object('event', 'page_view', 'visitor_id', 'visitor-aaaa', 'session_id', 'session-aaaa', 'path', '/', 'utm_source', 'Instagram', 'device', 'mobile'),
  jsonb_build_object('event', 'product_view', 'visitor_id', 'visitor-aaaa', 'session_id', 'session-aaaa', 'product_id', 'd0000000-0000-4000-8000-000000000003'),
  jsonb_build_object('event', 'search', 'visitor_id', 'visitor-aaaa', 'session_id', 'session-aaaa', 'query', '  Candles ', 'results', 0),
  jsonb_build_object('event', 'add_to_cart', 'visitor_id', 'visitor-aaaa', 'session_id', 'session-aaaa', 'product_id', 'd0000000-0000-4000-8000-000000000003'),
  jsonb_build_object('event', 'begin_checkout', 'visitor_id', 'visitor-aaaa', 'session_id', 'session-aaaa', 'order_id', (select v from gt where k = 'P')),
  jsonb_build_object('event', 'hack', 'visitor_id', 'visitor-aaaa', 'session_id', 'session-aaaa'),
  jsonb_build_object('event', 'page_view', 'visitor_id', 'x', 'session_id', 'session-aaaa'),
  jsonb_build_object('event', 'page_view', 'visitor_id', 'visitor-bbbb', 'session_id', 'session-bbbb', 'referrer_host', 'www.google.com', 'device', 'desktop')
)) = 6, 'valid events are stored; unknown events and bad ids are skipped');
insert into gj select 'a', public.svc_analytics('44444444-4444-4444-8444-444444444444', internal.local_date(now()) - 1, internal.local_date(now()));
select test.ok((select (v -> 'totals' ->> 'visitors')::int = 2 and (v -> 'totals' ->> 'sessions')::int = 2 from gj where k = 'a'),
  'visitors and sessions are counted');
select test.ok((select (v -> 'funnel' -> 4 ->> 'sessions')::int = 1 from gj where k = 'a'), 'a checkout that got paid counts as bought');
select test.ok((select (v -> 'totals' ->> 'conversion_rate')::numeric = 0.5 from gj where k = 'a'), 'conversion = bought / sessions');
select test.ok((select s ->> 'query' = 'candles' and (s ->> 'no_results')::int = 1 from gj, jsonb_array_elements(v -> 'searches') s where k = 'a'),
  'searches are tidied, and no-result searches are flagged');
select test.ok((select bool_or(s ->> 'source' = 'instagram' and (s ->> 'purchases')::int = 1) from gj, jsonb_array_elements(v -> 'sources') s where k = 'a'),
  'sales are credited to the first-touch source');
select test.ok((select (v -> 'totals' ->> 'gross_profit_cents') is not null from gj where k = 'a'), 'the owner sees profit');
select test.ok(exists (select 1 from gj, jsonb_array_elements(v -> 'order_sources') s where k = 'a' and s ->> 'source' = 'phone'),
  'orders are split by where they came from');
reset role;

insert into auth.users (id, email) values ('7a7a7a7a-7777-4777-8777-777777777777', 'ana@giftora.ca');
insert into internal.staff_members (user_id, role_key, display_name) values ('7a7a7a7a-7777-4777-8777-777777777777', 'marketing_manager', 'Mia (marketing)');
insert into internal.role_permissions (role_key, permission_key) values ('marketing_manager', 'analytics.view') on conflict do nothing;
set role service_role;
select test.ok((public.svc_analytics('7a7a7a7a-7777-4777-8777-777777777777', internal.local_date(now()) - 1, internal.local_date(now()))
                -> 'totals' ->> 'gross_profit_cents') is null, 'marketing, without finance access, sees no profit');
select test.throws(format('select public.svc_analytics(%L, %L, %L)', '44444444-4444-4444-8444-444444444444', '2020-01-01', '2026-01-01'),
  'up to a year', 'ranges are capped at a year');
select test.throws(format('select public.svc_analytics(%L, current_date, current_date)', '55555555-5555-4555-8555-555555555555'),
  'analytics.view', 'packing staff can''t read analytics');

-- ---------------------------------------------------------------- SEO checklist
insert into gj select 's', public.svc_seo_audit('44444444-4444-4444-8444-444444444444');
select test.ok((select jsonb_array_length(v -> 'products') > 0 from gj where k = 's')
               and exists (select 1 from gj, jsonb_array_elements(v -> 'products') p, jsonb_array_elements_text(p -> 'issues') i
                            where k = 's' and i = 'No meta description'),
  'the SEO checklist lists what each live product is missing');
reset role;
