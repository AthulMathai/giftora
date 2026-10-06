-- Bulk import from a supplier sheet, and photo matching by item number.
\set ON_ERROR_STOP 1
\set QUIET 1

create temp table ij (k text primary key, v jsonb);
grant all on ij to service_role;

set role service_role;
insert into ij values ('sheet', '[
  {"row": 2, "item_number": "mug 12oz.blu", "name": "MUG CERAMIC 12OZ BLUE", "title": "Speckled Blue Mug", "category": "Mugs & Cups",
   "cost_cents": 800, "on_hand_qty": 24, "aisle_location": "C7", "barcode": "0628000999001", "inner_qty": 6, "outer_qty": 24,
   "occasions": ["birthday"], "recipients": ["coffee-lover"]},
  {"row": 3, "item_number": "TEE-S", "name": "Cotton Tee", "group": "TEE", "options": {"Size": "S"}, "cost_cents": 900, "on_hand_qty": 5},
  {"row": 4, "item_number": "TEE-M", "name": "Cotton Tee", "group": "TEE", "options": {"Size": "M"}, "cost_cents": 900, "on_hand_qty": 5},
  {"row": 5, "item_number": "CND-TRIO-01", "name": "Supplier candle name", "cost_cents": 1900, "aisle_location": "D3"},
  {"row": 6, "item_number": "WL-BLK"},
  {"row": 7, "item_number": "TEE-S", "name": "Cotton Tee again"},
  {"row": 8, "item_number": "", "name": "No number"},
  {"row": 9, "item_number": "NEW-NOCOST", "name": "Mystery item"}
]'::jsonb);

insert into ij select 'p', public.svc_import_preview('44444444-4444-4444-8444-444444444444', (select v from ij where k = 'sheet'));
select test.ok((select v -> 'summary' = '{"new":4,"update":1,"same":1,"error":2}'::jsonb from ij where k = 'p'),
  'preview: 4 new, 1 update, 1 unchanged, 2 problems');
select test.ok((select x ->> 'action' = 'error' and x -> 'messages' ->> 0 like 'Duplicate%row 3%' from ij, jsonb_array_elements(v -> 'rows') x
                 where k = 'p' and (x ->> 'row')::int = 7), 'a repeated item number in the same file is flagged');
select test.ok((select x -> 'changes' @> '[{"field":"cost","to":1900},{"field":"location","to":"D3"}]'::jsonb
                       and not (x -> 'changes' @> '[{"field":"name"}]'::jsonb)
                  from ij, jsonb_array_elements(v -> 'rows') x where k = 'p' and (x ->> 'row')::int = 5),
  'updates show what changes; names are left alone by default');
select test.ok((select x -> 'messages' ->> 0 like 'New category%' from ij, jsonb_array_elements(v -> 'rows') x
                 where k = 'p' and (x ->> 'row')::int = 2), 'an unknown category is announced');
select test.throws(format('select public.svc_import_preview(%L, %L::jsonb)', '55555555-5555-4555-8555-555555555555', '[]'),
  'catalog.edit', 'packing staff can''t import');

insert into ij select 'a', public.svc_import_apply('44444444-4444-4444-8444-444444444444', (select v from ij where k = 'sheet'), false, true);
select test.ok((select (v ->> 'created_products')::int = 3 and (v ->> 'created_items')::int = 4 and (v ->> 'updated')::int = 1
                       and jsonb_array_length(v -> 'errors') = 2 from ij where k = 'a'),
  'apply: 3 products (the tee sizes share one), 4 items, 1 update, 2 rows skipped');
select test.ok((select p.name = 'Speckled Blue Mug' and p.status = 'active' and c.name = 'Mugs & Cups' and v.sku = 'MUG-12OZ-BLU'
                       and v.price_cents is not null and 'birthday' = any (p.occasions)
                  from public.product_variants v join public.products p on p.id = v.product_id join public.categories c on c.id = p.category_id
                 where v.sku = 'MUG-12OZ-BLU'), 'a new item gets a product, category, SKU and an engine-set price');
select test.ok((select si.inner_qty = 6 and si.outer_qty = 24 and si.aisle_location = 'C7' and si.supplier_sku = 'mug 12oz.blu'
                  from internal.supplier_items si join public.product_variants v on v.id = si.variant_id where v.sku = 'MUG-12OZ-BLU'),
  'supplier details, packs and the original item number are kept');
select test.ok((select count(*) = 2 and count(distinct product_id) = 1 from public.product_variants where sku in ('TEE-S', 'TEE-M')),
  'rows with the same group become sizes of one product');
select test.ok((select si.cost_cents = 1900 and si.aisle_location = 'D3' and si.on_hand_qty is not null and p.name = 'Scented Soy Candle Trio'
                  from internal.supplier_items si join public.product_variants v on v.id = si.variant_id join public.products p on p.id = v.product_id
                 where v.sku = 'CND-TRIO-01'), 'an update changes cost and location, keeps stock and the customer-facing name');
select test.ok((select price_cents is null from public.product_variants where sku = 'NEW-NOCOST'), 'an item without a cost has no price, so it can''t be sold');

-- Re-upload the same sheet: nothing new.
insert into ij select 'again', public.svc_import_preview('44444444-4444-4444-8444-444444444444', (select v from ij where k = 'sheet'));
select test.ok((select (v -> 'summary' ->> 'new')::int = 0 and (v -> 'summary' ->> 'update')::int = 0 from ij where k = 'again'),
  're-uploading the same sheet adds and changes nothing');
-- A later sheet adds a size to the same group.
select public.svc_import_apply('44444444-4444-4444-8444-444444444444',
  '[{"row":2,"item_number":"TEE-L","name":"Cotton Tee","group":"TEE","options":{"Size":"L"},"cost_cents":900}]', false, false);
select test.ok((select count(distinct product_id) = 1 from public.product_variants where sku in ('TEE-S', 'TEE-L')),
  'a new size in a later sheet joins the existing product');
-- Content updates only when asked.
select public.svc_import_apply('44444444-4444-4444-8444-444444444444',
  '[{"row":2,"item_number":"CND-TRIO-01","name":"Candle Trio (Cedar, Fig, Vanilla)"}]', true, false);
select test.ok((select p.name from public.products p join public.product_variants v on v.product_id = p.id where v.sku = 'CND-TRIO-01')
               = 'Candle Trio (Cedar, Fig, Vanilla)', 'names update when staff choose to');

-- Photos
insert into ij select 't', public.svc_photo_targets('44444444-4444-4444-8444-444444444444', array['mug 12oz.blu', 'TEE-M', 'NOPE']);
select test.ok((select v ? 'mug 12oz.blu' and v ? 'TEE-M' and not v ? 'NOPE' and (v -> 'TEE-M' ->> 'multi_variant')::boolean from ij where k = 't'),
  'photo files match products by item number (original or normalized)');
select test.ok(public.svc_image_add_named('44444444-4444-4444-8444-444444444444',
                 (select (v -> 'TEE-M' ->> 'product_id')::uuid from ij where k = 't'), 'https://x/tee.jpg', null, 'TEE-M.jpg') is not null,
  'first upload is saved');
select test.ok(public.svc_image_add_named('44444444-4444-4444-8444-444444444444',
                 (select (v -> 'TEE-M' ->> 'product_id')::uuid from ij where k = 't'), 'https://x/tee2.jpg', null, 'TEE-M.jpg') is null,
  'the same file uploaded again is skipped');
reset role;
