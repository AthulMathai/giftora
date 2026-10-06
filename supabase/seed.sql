-- Demo data for local development and preview branches. Not for production.
-- Prices are not typed in: they are computed from supplier cost by the pricing rules.

insert into internal.pricing_rules (scope, rule_type, rate, min_margin, min_profit_cents, rounding, notes)
values ('global', 'margin', 0.10, 0.05, 300, 'charm_99', 'Global 10% margin; never below 5% margin or $3 profit');

insert into internal.suppliers (id, name, location, notes) values
  ('5a000000-0000-4000-8000-000000000001', 'Primary Supplier', 'Toronto, ON', 'Main pickup location');

insert into public.categories (id, slug, name, description, sort_order) values
  ('ca000000-0000-4000-8000-000000000001', 'apparel',        'Apparel',        'Cozy, wearable gifts', 1),
  ('ca000000-0000-4000-8000-000000000002', 'home-kitchen',   'Home & Kitchen', 'Gifts for the home', 2),
  ('ca000000-0000-4000-8000-000000000003', 'accessories',    'Accessories',    'Small things they''ll use every day', 3);

-- Apparel carries a higher margin than the global default, to show rule precedence.
insert into internal.pricing_rules (scope, category_id, rule_type, rate, notes)
values ('category', 'ca000000-0000-4000-8000-000000000001', 'margin', 0.25, 'Apparel 25% margin');

insert into public.products (id, slug, name, description, category_id, status, tags, occasions, recipients, option_names, published_at) values
  ('d0000000-0000-4000-8000-000000000001', 'personalized-hoodie', 'Personalized Hoodie',
   'Heavyweight cotton-blend hoodie, embroidered with a name or short message.',
   'ca000000-0000-4000-8000-000000000001', 'active',
   '{hoodie,personalized,cozy}', '{birthday,christmas}', '{him,her,teen}', '{Size,Colour}', now()),
  ('d0000000-0000-4000-8000-000000000002', 'pour-over-coffee-set', 'Ceramic Pour-Over Coffee Set',
   'Hand-glazed ceramic dripper, carafe and two cups for slow mornings.',
   'ca000000-0000-4000-8000-000000000002', 'active',
   '{coffee,ceramic,kitchen}', '{birthday,housewarming,christmas}', '{coffee-lover,her,him}', '{}', now()),
  ('d0000000-0000-4000-8000-000000000003', 'soy-candle-trio', 'Scented Soy Candle Trio',
   'Three hand-poured soy candles: cedar, fig and vanilla bean.',
   'ca000000-0000-4000-8000-000000000002', 'active',
   '{candle,scented,relax}', '{birthday,thank-you,christmas}', '{her,mom,friend}', '{}', now()),
  ('d0000000-0000-4000-8000-000000000004', 'leather-card-wallet', 'Leather Card Wallet',
   'Slim full-grain leather wallet with four card slots.',
   'ca000000-0000-4000-8000-000000000003', 'active',
   '{wallet,leather}', '{birthday,fathers-day,graduation}', '{him,dad}', '{Colour}', now()),
  ('d0000000-0000-4000-8000-000000000005', 'knit-throw-blanket', 'Cozy Knit Throw Blanket',
   'Chunky knit throw, 127 × 152 cm, in soft grey.',
   'ca000000-0000-4000-8000-000000000002', 'active',
   '{blanket,cozy,home}', '{housewarming,christmas}', '{her,mom,couple}', '{}', now());

insert into public.product_variants (id, product_id, sku, options, label, sort_order) values
  ('e0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000001', 'HD-BLK-S', '{"Size":"S","Colour":"Black"}', 'Small / Black', 1),
  ('e0000000-0000-4000-8000-000000000102', 'd0000000-0000-4000-8000-000000000001', 'HD-BLK-M', '{"Size":"M","Colour":"Black"}', 'Medium / Black', 2),
  ('e0000000-0000-4000-8000-000000000103', 'd0000000-0000-4000-8000-000000000001', 'HD-BLK-L', '{"Size":"L","Colour":"Black"}', 'Large / Black', 3),
  ('e0000000-0000-4000-8000-000000000104', 'd0000000-0000-4000-8000-000000000001', 'HD-WHT-S', '{"Size":"S","Colour":"White"}', 'Small / White', 4),
  ('e0000000-0000-4000-8000-000000000105', 'd0000000-0000-4000-8000-000000000001', 'HD-WHT-M', '{"Size":"M","Colour":"White"}', 'Medium / White', 5),
  ('e0000000-0000-4000-8000-000000000106', 'd0000000-0000-4000-8000-000000000001', 'HD-WHT-L', '{"Size":"L","Colour":"White"}', 'Large / White', 6),
  ('e0000000-0000-4000-8000-000000000201', 'd0000000-0000-4000-8000-000000000002', 'CF-POUR-01', '{}', 'Default', 1),
  ('e0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000003', 'CND-TRIO-01', '{}', 'Default', 1),
  ('e0000000-0000-4000-8000-000000000401', 'd0000000-0000-4000-8000-000000000004', 'WL-BRN', '{"Colour":"Brown"}', 'Brown', 1),
  ('e0000000-0000-4000-8000-000000000402', 'd0000000-0000-4000-8000-000000000004', 'WL-BLK', '{"Colour":"Black"}', 'Black', 2),
  ('e0000000-0000-4000-8000-000000000501', 'd0000000-0000-4000-8000-000000000005', 'TH-KNIT-GRY', '{}', 'Grey', 1);

-- Supplier stock and cost. Inserting these computes each variant's price.
insert into internal.supplier_items (supplier_id, variant_id, supplier_sku, supplier_barcode, cost_cents, on_hand_qty, aisle_location, last_checked_at)
select '5a000000-0000-4000-8000-000000000001', v.id, 'SUP-' || v.sku, x.barcode, x.cost, x.qty, x.aisle, now()
from (values
  ('HD-BLK-S', '0628000000011', 2800, 4, 'A1'), ('HD-BLK-M', '0628000000028', 2800, 6, 'A1'),
  ('HD-BLK-L', '0628000000035', 2800, 3, 'A1'), ('HD-WHT-S', '0628000000042', 2800, 2, 'A2'),
  ('HD-WHT-M', '0628000000059', 2800, 5, 'A2'), ('HD-WHT-L', '0628000000066', 2800, 1, 'A2'),
  ('CF-POUR-01', '0628000000073', 3200, 8, 'C4'), ('CND-TRIO-01', null, 1800, 12, 'D2'),
  ('WL-BRN', '0628000000097', 2200, 5, 'B3'), ('WL-BLK', '0628000000103', 2200, 7, 'B3'),
  ('TH-KNIT-GRY', '0628000000110', 3500, 4, 'E1')
) as x(sku, barcode, cost, qty, aisle)
join public.product_variants v on v.sku = x.sku;

insert into public.collections (id, slug, name, description) values
  ('c0000000-0000-4000-8000-000000000001', 'cozy-gifts', 'Cozy Gifts', 'Warm, soft things for cold Canadian evenings');
insert into public.collection_products (collection_id, product_id, sort_order) values
  ('c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 1),
  ('c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 2),
  ('c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 3);
