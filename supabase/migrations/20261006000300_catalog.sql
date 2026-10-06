-- Catalog: categories, products, variants (one SKU each), images, collections, barcodes.
-- Everything here is safe for customers to read. Cost never appears in these tables.

create type public.product_status as enum (
  'draft', 'active', 'out_of_stock', 'acquisition_unavailable',
  'paused', 'seasonal', 'archived', 'discontinued'
);

create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid references public.categories (id) on delete restrict,
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name         text not null,
  description  text,
  seo_title    text,
  seo_description text,
  sort_order   int not null default 0,
  is_visible   boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger categories_updated_at before update on public.categories
  for each row execute function internal.set_updated_at();

-- array_to_string is only STABLE; generated columns need an IMMUTABLE expression.
create or replace function internal.immutable_join(text[])
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select array_to_string($1, ' ') $$;

create table public.products (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name            text not null,
  description     text,
  category_id     uuid references public.categories (id) on delete restrict,
  status          public.product_status not null default 'draft',
  -- Gift-discovery metadata (occasions, recipients, interests) for filters and later AI search.
  tags            text[] not null default '{}',
  occasions       text[] not null default '{}',
  recipients      text[] not null default '{}',
  -- Option axes, e.g. ["Size","Colour"]; each variant supplies values for them.
  option_names    text[] not null default '{}',
  seo_title       text,
  seo_description text,
  search_tsv      tsvector generated always as (
                    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
                    setweight(to_tsvector('english', coalesce(internal.immutable_join(tags), '')), 'B') ||
                    setweight(to_tsvector('english', coalesce(description, '')), 'C')
                  ) stored,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index products_category_idx on public.products (category_id);
create index products_status_idx on public.products (status);
create index products_search_idx on public.products using gin (search_tsv);
create index products_name_trgm_idx on public.products using gin (name extensions.gin_trgm_ops);
create trigger products_updated_at before update on public.products
  for each row execute function internal.set_updated_at();

create table public.product_variants (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references public.products (id) on delete restrict,
  sku               text not null unique check (sku ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  -- Values matching products.option_names, e.g. {"Size":"M","Colour":"Black"}
  options           jsonb not null default '{}'::jsonb,
  label             text not null default 'Default',   -- "Medium / Black"
  -- Resolved selling price, maintained by the pricing engine (never typed in by hand).
  price_cents       public.money_cents,
  compare_at_cents  public.money_cents,
  weight_grams      int check (weight_grams > 0),
  is_active         boolean not null default true,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index product_variants_product_idx on public.product_variants (product_id);
create trigger product_variants_updated_at before update on public.product_variants
  for each row execute function internal.set_updated_at();

create table public.product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  variant_id  uuid references public.product_variants (id) on delete set null,
  url         text not null,
  alt_text    text not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id);

create table public.collections (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name          text not null,
  description   text,
  is_visible    boolean not null default true,
  starts_at     timestamptz,
  ends_at       timestamptz,
  seo_title     text,
  seo_description text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger collections_updated_at before update on public.collections
  for each row execute function internal.set_updated_at();

create table public.collection_products (
  collection_id uuid not null references public.collections (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  sort_order    int not null default 0,
  primary key (collection_id, product_id)
);

-- Barcodes are operational, so they live internally. A variant can have several
-- (supplier UPC plus Giftora's own SKU barcode).
create table internal.variant_barcodes (
  id          uuid primary key default gen_random_uuid(),
  variant_id  uuid not null references public.product_variants (id) on delete cascade,
  code        text not null unique,
  kind        text not null check (kind in ('supplier', 'giftora_sku', 'qr')),
  created_at  timestamptz not null default now()
);
create index variant_barcodes_variant_idx on internal.variant_barcodes (variant_id);

-- Every variant automatically gets its SKU as a scannable Giftora barcode.
create or replace function internal.add_sku_barcode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into internal.variant_barcodes (variant_id, code, kind)
  values (new.id, new.sku, 'giftora_sku')
  on conflict (code) do nothing;
  return new;
end;
$$;
create trigger product_variants_sku_barcode after insert on public.product_variants
  for each row execute function internal.add_sku_barcode();

-- ---------------------------------------------------------------------------
-- RLS: customers (and anonymous visitors) read only what is published.
-- Writes happen only through the staff app's server (service role).
-- ---------------------------------------------------------------------------
create or replace function public.is_customer_visible(s public.product_status)
returns boolean
language sql immutable
set search_path = ''
as $$ select s in ('active', 'out_of_stock', 'acquisition_unavailable', 'seasonal', 'archived') $$;
grant execute on function public.is_customer_visible(public.product_status) to anon, authenticated;

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.collections enable row level security;
alter table public.collection_products enable row level security;

create policy "categories: public read" on public.categories
  for select to anon, authenticated using (is_visible);

create policy "products: public read" on public.products
  for select to anon, authenticated using (public.is_customer_visible(status));

create policy "variants: public read" on public.product_variants
  for select to anon, authenticated using (
    is_active and exists (
      select 1 from public.products p
      where p.id = product_id and public.is_customer_visible(p.status)
    )
  );

create policy "images: public read" on public.product_images
  for select to anon, authenticated using (
    exists (select 1 from public.products p
            where p.id = product_id and public.is_customer_visible(p.status))
  );

create policy "collections: public read" on public.collections
  for select to anon, authenticated using (
    is_visible and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
  );

create policy "collection products: public read" on public.collection_products
  for select to anon, authenticated using (true);

-- Clients get read-only access to the catalog regardless of policies.
revoke insert, update, delete, truncate on
  public.categories, public.products, public.product_variants,
  public.product_images, public.collections, public.collection_products
  from anon, authenticated;
