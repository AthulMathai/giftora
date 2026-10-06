-- Catalog admin tests. Runs after 02_service_api_test.sql (Ivan = super admin,
-- Olivia = order manager, Fay = fulfillment helper). The global rule is a 20% margin
-- (raised in core_rules_test), $3 minimum profit, rounded up to .99.
\set ON_ERROR_STOP 1
\set QUIET 1

create temp table ids (k text primary key, v uuid);
grant all on ids to service_role;

set role service_role;

-- ===========================================================================
-- Permissions
-- ===========================================================================
select test.throws('select public.svc_product_save(''33333333-3333-4333-8333-333333333333'', ''{"name":"X","slug":"x"}'')',
  'catalog.edit', 'order manager cannot create products');
select test.throws('select public.svc_catalog_products(''55555555-5555-4555-8555-555555555555'')',
  'catalog.view', 'fulfillment helper cannot browse the catalog admin');
select test.throws('select public.svc_pricing_rules(''33333333-3333-4333-8333-333333333333'')',
  'finance.view', 'order manager cannot see pricing rules');

-- ===========================================================================
-- Products and variants
-- ===========================================================================
insert into ids select 'mug', public.svc_product_save('44444444-4444-4444-8444-444444444444', jsonb_build_object(
  'name', 'Hand-thrown Mug', 'slug', 'hand-thrown-mug', 'description', 'Stoneware, 350 ml.',
  'category_id', 'ca000000-0000-4000-8000-000000000002', 'status', 'draft',
  'tags', jsonb_build_array('mug', ' coffee ', ''), 'occasions', jsonb_build_array('birthday'),
  'option_names', jsonb_build_array('Glaze')));
select test.ok((select tags = '{mug,coffee}' from public.products where id = (select v from ids where k = 'mug')),
  'tags are trimmed and blanks dropped');
select test.ok((select published_at is null from public.products where id = (select v from ids where k = 'mug')),
  'a draft product is not published');
select test.throws('select public.svc_product_save(''44444444-4444-4444-8444-444444444444'', ''{"name":"","slug":"y"}'')',
  'name is required', 'product name is required');

insert into ids select 'blue', public.svc_variant_save('44444444-4444-4444-8444-444444444444', jsonb_build_object(
  'product_id', (select v from ids where k = 'mug'), 'sku', 'mug-blu', 'label', 'Blue', 'options', '{"Glaze":"Blue"}',
  'cost_cents', 1500, 'on_hand_qty', 6, 'supplier_barcode', '0628000000999', 'aisle_location', 'C2'));
select test.ok((select sku from public.product_variants where id = (select v from ids where k = 'blue')) = 'MUG-BLU',
  'SKU is upper-cased');
select test.ok((select price_cents from public.product_variants where id = (select v from ids where k = 'blue')) = 1899,
  'saving a cost prices the variant: $15.00 at 20% margin = $18.75 -> $18.99');
select test.ok(exists (select 1 from internal.variant_barcodes where code = '0628000000999'), 'supplier barcode becomes scannable');
select test.ok(exists (select 1 from internal.variant_barcodes where code = 'MUG-BLU'), 'SKU barcode is created');
select test.ok(internal.available_qty((select v from ids where k = 'blue')) = 6, 'saving stock counts as a fresh check');
select test.throws(format('select public.svc_variant_save(%L, %L)', '44444444-4444-4444-8444-444444444444',
  jsonb_build_object('product_id', (select v from ids where k = 'mug'), 'sku', 'HD-BLK-M')),
  'duplicate key', 'SKUs must be unique');

select public.svc_variant_save('44444444-4444-4444-8444-444444444444', jsonb_build_object(
  'id', (select v from ids where k = 'blue'), 'product_id', (select v from ids where k = 'mug'),
  'sku', 'MUG-BLU', 'label', 'Blue', 'cost_cents', 1600, 'on_hand_qty', 6));
select test.ok((select price_cents from public.product_variants where id = (select v from ids where k = 'blue')) = 2099,
  'a cost change reprices: $16.00 -> $20.00 -> $20.99');

-- An editor who can change listings but not supplier cost (marketing, given catalog.edit for this test)
reset role;
insert into auth.users (id, email) values ('66666666-6666-4666-8666-666666666666', 'mia@giftora.ca') on conflict do nothing;
insert into internal.staff_members (user_id, role_key, display_name)
values ('66666666-6666-4666-8666-666666666666', 'marketing_manager', 'Mia (marketing)') on conflict do nothing;
insert into internal.role_permissions values ('marketing_manager', 'catalog.edit') on conflict do nothing;
set role service_role;
select test.throws(format('select public.svc_variant_save(%L, %L)', '66666666-6666-4666-8666-666666666666',
  jsonb_build_object('id', (select v from ids where k = 'blue'), 'product_id', (select v from ids where k = 'mug'),
                     'sku', 'MUG-BLU', 'cost_cents', 1)),
  'suppliers.edit', 'an editor without supplier access cannot change cost');
select test.ok(not ((public.svc_product_get('66666666-6666-4666-8666-666666666666', (select v from ids where k = 'mug'))
                 -> 'variants' -> 0) ? 'cost_cents'),
  'an editor without finance access does not see cost');
select test.ok((select (public.svc_product_get('44444444-4444-4444-8444-444444444444', (select v from ids where k = 'mug'))
                 -> 'variants' -> 0 ->> 'cost_cents')::int) = 1600,
  'owner sees cost in the editor');

-- Going live sets published_at; it shows up for customers
select public.svc_product_save('44444444-4444-4444-8444-444444444444', jsonb_build_object(
  'id', (select v from ids where k = 'mug'), 'name', 'Hand-thrown Mug', 'slug', 'hand-thrown-mug', 'status', 'active',
  'category_id', 'ca000000-0000-4000-8000-000000000002'));
reset role;
set role anon;
select test.ok(exists (select 1 from public.products where slug = 'hand-thrown-mug'), 'an active product is visible to customers');
reset role;
set role service_role;
select test.ok(exists (select 1 from internal.audit_logs where action = 'product.update'
                        and actor_id = '44444444-4444-4444-8444-444444444444'), 'product edits are audited');

-- Images
insert into ids select 'img1', public.svc_image_add('44444444-4444-4444-8444-444444444444', (select v from ids where k = 'mug'), 'https://x/1.jpg', '');
insert into ids select 'img2', public.svc_image_add('44444444-4444-4444-8444-444444444444', (select v from ids where k = 'mug'), 'https://x/2.jpg', 'Blue mug on a table');
select test.ok((select alt_text from public.product_images where id = (select v from ids where k = 'img1')) = 'Hand-thrown Mug',
  'alt text falls back to the product name');
select public.svc_image_make_first('44444444-4444-4444-8444-444444444444', (select v from ids where k = 'img2'));
select test.ok((select url from public.product_images where product_id = (select v from ids where k = 'mug') order by sort_order limit 1) = 'https://x/2.jpg',
  'make-first reorders photos');
select test.ok(public.svc_image_delete('44444444-4444-4444-8444-444444444444', (select v from ids where k = 'img1')) = 'https://x/1.jpg',
  'deleting a photo returns its URL for storage cleanup');

-- ===========================================================================
-- Stock checks
-- ===========================================================================
select test.ok((select bool_or(stale) = false from jsonb_to_recordset(public.svc_stock_list('44444444-4444-4444-8444-444444444444')) as x(stale boolean)),
  'freshly seeded stock is not stale');
update internal.supplier_items set last_checked_at = now() - interval '4 days' where variant_id = (select v from ids where k = 'blue');
select test.ok(internal.available_qty((select v from ids where k = 'blue')) = 0, 'stale stock (over 72 h) is not sellable');
select test.ok(public.svc_stock_update('44444444-4444-4444-8444-444444444444',
  jsonb_build_array(jsonb_build_object('variant_id', (select v from ids where k = 'blue'), 'on_hand_qty', 3))) = 1,
  'stock check updates the row');
select test.ok(internal.available_qty((select v from ids where k = 'blue')) = 3, 'a stock check makes it sellable again');
select test.throws('select public.svc_stock_update(''33333333-3333-4333-8333-333333333333'', ''[]'')',
  'suppliers.edit', 'order manager cannot change stock');

-- ===========================================================================
-- Pricing rules
-- ===========================================================================
select test.ok((public.svc_pricing_preview('44444444-4444-4444-8444-444444444444', 'margin', 0.30) ->> 'variants_affected')::int > 0,
  'a global margin preview reports affected variants');
select public.svc_pricing_rule_save('44444444-4444-4444-8444-444444444444', jsonb_build_object(
  'scope', 'product', 'target_id', (select v from ids where k = 'mug'), 'rule_type', 'markup', 'rate', 0.5,
  'reason', 'Handmade premium'));
select test.ok((select price_cents from public.product_variants where id = (select v from ids where k = 'blue')) = 2499,
  'product rule overrides global: $16.00 + 50% markup = $24.00 -> $24.99');
select test.ok(exists (select 1 from internal.audit_logs where object_type = 'internal.pricing_rules' and reason = 'Handmade premium'),
  'pricing change audited with reason');
select public.svc_pricing_rule_save('44444444-4444-4444-8444-444444444444', jsonb_build_object(
  'scope', 'product', 'target_id', (select v from ids where k = 'mug'), 'rule_type', 'markup', 'rate', 0.4));
select test.ok((select count(*) from internal.pricing_rules where active and product_id = (select v from ids where k = 'mug')) = 1,
  'saving again replaces the rule instead of adding a second');
select test.throws(format('select public.svc_pricing_rule_remove(%L, %L, ''x'')', '44444444-4444-4444-8444-444444444444',
  (select id from internal.pricing_rules where active and scope = 'global')),
  'not removed', 'the global rule cannot be removed');
select public.svc_pricing_rule_remove('44444444-4444-4444-8444-444444444444',
  (select id from internal.pricing_rules where active and product_id = (select v from ids where k = 'mug')), 'back to default');
select test.ok((select price_cents from public.product_variants where id = (select v from ids where k = 'blue')) = 2099,
  'removing the product rule falls back to the global margin');
select test.ok(jsonb_array_length(public.svc_pricing_rules('44444444-4444-4444-8444-444444444444')) = 2,
  'active rules listed: global + apparel category');

-- Categories
select public.svc_category_save('44444444-4444-4444-8444-444444444444', '{"name":"For Pets","slug":"for-pets"}');
select test.ok((select count(*) from jsonb_array_elements(public.svc_categories('44444444-4444-4444-8444-444444444444')) c
                where c ->> 'slug' = 'for-pets') = 1, 'category created');
reset role;

-- Hardening
set role anon;
select test.throws('select * from public.start_checkout(gen_random_uuid(), ''standard'')', 'permission denied',
  'signed-out visitors cannot call start_checkout');
select test.throws('select * from public.my_staff_permissions()', 'permission denied',
  'signed-out visitors cannot call my_staff_permissions');
reset role;

\echo 'All catalog admin tests passed.'
