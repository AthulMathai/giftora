# Giftora

Gift commerce + order-first fulfillment for Canada. Customers buy; Giftora then acquires the exact
items from its supplier, scan-sorts them into per-order bins, and ships.

Roadmap & architecture: see the "Giftora — Roadmap & Architecture" doc.

## Layout

```
apps/
  storefront/      Customer site (Next.js) — giftora.ca
  staff/           Admin + fulfillment app (Next.js) — admin.giftora.ca
packages/
  pricing/         Markup/margin pricing engine (mirrors the SQL engine, tested to agree)
supabase/
  migrations/      Every schema change, in order
  seed.sql         Demo catalog for local/preview databases
  tests/database/  Business-rule tests (run by CI against real Postgres)
scripts/test-db.sh Rebuild a scratch DB from migrations + seed and run the rule tests
```

## Rules that the code enforces (don't work around them)

1. **Customer data vs internal data.** Cost, supplier, profit, reservations and fulfillment live in the
   `internal` Postgres schema, which the Supabase API never exposes. No table in `public` has a cost,
   supplier, profit or margin column — a test fails the build if one appears.
2. **Prices are computed, never typed.** A variant's `price_cents` comes from supplier cost + the active
   pricing rule (variant > product > category > global). Every rule says whether it is a `markup`
   (% of cost) or a `margin` (% of price).
3. **Orders are frozen.** Each order line snapshots name, SKU, price, cost and the rule used. A trigger
   rejects any edit; refunds, fees and shipping costs are added as `internal.order_adjustments`.
4. **No overselling.** `start_checkout()` locks the supplier rows, checks fresh supplier stock minus
   active holds, and places a 15-minute hold. Unpaid holds are released by `expire_checkouts()`.
5. **Everything sensitive is audited.** `internal.audit_logs` is append-only, even for super admins.
6. **The service-role key never reaches a browser.** Only `apps/staff/lib/supabase/admin.ts` uses it,
   and only after `requireStaff(permission)`.

## Run it

Requirements: Node 22+, pnpm 10, a Supabase project (or local Postgres for the DB tests).

```bash
pnpm install
cp apps/storefront/.env.example apps/storefront/.env.local   # fill in Supabase URL + anon key
cp apps/staff/.env.example apps/staff/.env.local             # + service-role key
pnpm dev            # storefront on :3000, staff on :3001
pnpm test           # pricing engine unit tests
PGHOST=localhost PGUSER=postgres pnpm test:db   # database rule tests
```

Applying the schema to Supabase: run the files in `supabase/migrations/` in order (Supabase CLI:
`supabase db push`), then `supabase/seed.sql` on non-production databases only.

## Staff roles

| Role | Sees cost & profit | Main areas |
| --- | --- | --- |
| Super Admin | Yes | Everything |
| Inventory Manager | Yes | Products, suppliers, pricing |
| Order Manager | No | Orders, fulfillment, overrides |
| Fulfillment Staff | No | Picking, sorting, packing |
| Marketing Manager | No | Campaigns, SEO |
| Customer Support | No | Customers, orders |
| Analyst | Yes (read-only) | Analytics, reports |

Staff accounts require two-factor authentication.

## Tax

`internal.tax_rules` holds GST/HST rates by destination province. PST/QST/RST are set to 0 until
Giftora registers in those provinces. **Have a Canadian accountant confirm the table before launch.**
