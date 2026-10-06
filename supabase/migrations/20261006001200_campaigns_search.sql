-- Seasonal campaigns (spec §46) and storefront search (§50).
--
-- A campaign is a scheduled season: Halloween, Christmas, Valentine's Day, or anything custom.
--   early_from  .. starts_at : "Shop early" — the season shows as a section, products are buyable
--   starts_at   .. ends_at   : live — the season takes over the home page and can restyle the site
--   after ends_at            : the normal Giftora look returns automatically; the page stays for SEO
-- Products join a campaign by occasion tag (e.g. every product tagged "christmas") and/or by hand.

create table public.campaigns (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name             text not null check (length(name) between 2 and 80),
  theme            text not null default 'custom' check (theme in (
                     'christmas', 'halloween', 'valentines', 'easter', 'mothers_day', 'fathers_day',
                     'black_friday', 'new_year', 'back_to_school', 'winter', 'spring', 'summer', 'autumn', 'custom')),
  occasion         text check (occasion ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  eyebrow          text,
  headline         text not null,
  subheadline      text,
  body             text,
  early_message    text,
  cta_label        text not null default 'Shop the collection',
  accent_color     text not null default '#d9533b' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  background_color text not null default '#fbf6ef' check (background_color ~ '^#[0-9a-fA-F]{6}$'),
  ink_color        text not null default '#2b1b2e' check (ink_color ~ '^#[0-9a-fA-F]{6}$'),
  early_from       timestamptz,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  restyle_site     boolean not null default true,
  priority         int not null default 0,
  is_published     boolean not null default false,
  seo_title        text,
  seo_description  text,
  faq              jsonb not null default '[]'::jsonb check (jsonb_typeof(faq) = 'array'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint campaign_dates check (ends_at > starts_at and (early_from is null or early_from <= starts_at))
);
create index campaigns_window_idx on public.campaigns (is_published, ends_at);
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function internal.set_updated_at();
create trigger campaigns_audit after insert or update or delete on public.campaigns
  for each row execute function internal.audit_row_change();

create table public.campaign_products (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  sort_order  int not null default 0,
  primary key (campaign_id, product_id)
);
create index campaign_products_product_idx on public.campaign_products (product_id);

alter table public.campaigns enable row level security;
alter table public.campaign_products enable row level security;
-- Campaign content is marketing copy: published ones are public (past ones too, for their SEO pages).
create policy "campaigns: public read" on public.campaigns
  for select to anon, authenticated using (is_published);
create policy "campaign products: public read" on public.campaign_products
  for select to anon, authenticated using (
    exists (select 1 from public.campaigns c where c.id = campaign_id and c.is_published)
  );
revoke insert, update, delete, truncate on public.campaigns, public.campaign_products from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff: campaign editor (marketing.edit)
-- ---------------------------------------------------------------------------
create or replace function internal.campaign_json(c public.campaigns)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(c) || jsonb_build_object(
    'phase', case
      when now() >= c.ends_at then 'ended'
      when now() >= c.starts_at then 'live'
      when c.early_from is not null and now() >= c.early_from then 'early'
      else 'upcoming' end,
    'product_count', (
      select count(*) from public.products p
       where p.status in ('active', 'seasonal')
         and ((c.occasion is not null and c.occasion = any (p.occasions))
              or exists (select 1 from public.campaign_products cp where cp.campaign_id = c.id and cp.product_id = p.id))));
$$;

create or replace function public.svc_campaigns(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'marketing.edit');
  return coalesce((select jsonb_agg(internal.campaign_json(c) order by c.starts_at desc) from public.campaigns c), '[]'::jsonb);
end;
$$;

create or replace function public.svc_campaign_get(p_actor uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
begin
  perform internal.act_as(p_actor, 'marketing.edit');
  select * into c from public.campaigns where id = p_id;
  if not found then return null; end if;
  return internal.campaign_json(c) || jsonb_build_object(
    'pinned', coalesce((select jsonb_agg(cp.product_id order by cp.sort_order) from public.campaign_products cp
                         where cp.campaign_id = p_id), '[]'::jsonb));
end;
$$;

create or replace function public.svc_campaign_save(p_actor uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform internal.act_as(p_actor, 'marketing.edit');
  if coalesce(btrim(p ->> 'name'), '') = '' or coalesce(btrim(p ->> 'headline'), '') = '' then
    raise exception 'Give the campaign a name and a headline' using errcode = 'P0020';
  end if;
  if v_id is null then
    insert into public.campaigns (slug, name, headline, starts_at, ends_at)
    values (p ->> 'slug', p ->> 'name', p ->> 'headline', (p ->> 'starts_at')::timestamptz, (p ->> 'ends_at')::timestamptz)
    returning id into v_id;
  end if;
  update public.campaigns set
    slug             = p ->> 'slug',
    name             = btrim(p ->> 'name'),
    theme            = coalesce(nullif(p ->> 'theme', ''), 'custom'),
    occasion         = nullif(btrim(p ->> 'occasion'), ''),
    eyebrow          = nullif(btrim(p ->> 'eyebrow'), ''),
    headline         = btrim(p ->> 'headline'),
    subheadline      = nullif(btrim(p ->> 'subheadline'), ''),
    body             = nullif(btrim(p ->> 'body'), ''),
    early_message    = nullif(btrim(p ->> 'early_message'), ''),
    cta_label        = coalesce(nullif(btrim(p ->> 'cta_label'), ''), 'Shop the collection'),
    accent_color     = coalesce(nullif(p ->> 'accent_color', ''), accent_color),
    background_color = coalesce(nullif(p ->> 'background_color', ''), background_color),
    ink_color        = coalesce(nullif(p ->> 'ink_color', ''), ink_color),
    early_from       = nullif(p ->> 'early_from', '')::timestamptz,
    starts_at        = (p ->> 'starts_at')::timestamptz,
    ends_at          = (p ->> 'ends_at')::timestamptz,
    restyle_site     = coalesce((p ->> 'restyle_site')::boolean, true),
    priority         = coalesce((p ->> 'priority')::int, 0),
    is_published     = coalesce((p ->> 'is_published')::boolean, false),
    seo_title        = nullif(btrim(p ->> 'seo_title'), ''),
    seo_description  = nullif(btrim(p ->> 'seo_description'), ''),
    faq              = coalesce(p -> 'faq', faq)
  where id = v_id;
  return v_id;
end;
$$;

create or replace function public.svc_campaign_products_set(p_actor uuid, p_id uuid, p_product_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'marketing.edit');
  delete from public.campaign_products where campaign_id = p_id;
  insert into public.campaign_products (campaign_id, product_id, sort_order)
  select p_id, x.id, x.n from unnest(p_product_ids) with ordinality as x(id, n)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storefront search: full-text with typo tolerance (trigram) over names, tags,
-- occasions and recipients. Runs as the caller, so RLS still decides visibility.
-- ---------------------------------------------------------------------------
create or replace function public.search_products(p_q text, p_limit int default 60)
returns table (product_id uuid, rank real)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select websearch_to_tsquery('english', left(coalesce(p_q, ''), 200)) as tsq,
           lower(btrim(left(coalesce(p_q, ''), 200))) as raw
  ), scored as (
    select p.id,
           ts_rank(p.search_tsv, q.tsq) * 2
           + extensions.word_similarity(q.raw, lower(p.name))
           + coalesce((select max(extensions.similarity(q.raw, replace(t, '-', ' ')))
                         from unnest(p.tags || p.occasions || p.recipients) t), 0) as score,
           p.search_tsv @@ q.tsq as fts
      from public.products p, q
     where q.raw <> '' and p.status in ('active', 'seasonal')
  )
  select id, score::real from scored
   where fts or score > 0.45
   order by score desc
   limit least(greatest(coalesce(p_limit, 60), 1), 200);
$$;
grant execute on function public.search_products(text, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Starter seasons. Edit or unpublish them in the staff app (Campaigns).
-- Times are Toronto local.
-- ---------------------------------------------------------------------------
insert into public.campaigns (slug, name, theme, occasion, eyebrow, headline, subheadline, body, early_message,
                              cta_label, accent_color, background_color, ink_color,
                              early_from, starts_at, ends_at, priority, is_published, seo_title, seo_description, faq)
values
  ('halloween', 'Halloween', 'halloween', 'halloween', 'Spooky season',
   'Treats, not tricks.', 'Cozy, playful gifts for the people who go all-out for October 31.',
   'Little surprises for Halloween hosts, costume people and anyone who loves a candle-lit autumn night.',
   null, 'Shop Halloween', '#e0701f', '#fbf1e6', '#2a1a2e',
   null, '2026-10-01 00:00 America/Toronto', '2026-11-01 00:00 America/Toronto', 10, true,
   'Halloween gifts in Canada', 'Playful Halloween gifts and hosting treats, hand-checked and shipped across Canada.',
   '[{"q":"When should I order Halloween gifts?","a":"Order by October 24 for standard shipping to arrive before Halloween in most of Canada."}]'),
  ('christmas', 'Christmas', 'christmas', 'christmas', 'Christmas 2026',
   'The merriest gifts, found early.', 'Thoughtful presents for everyone on your list, shipped across Canada.',
   'From stocking stuffers to the big one under the tree, every gift is checked by hand before it ships.',
   'Our Christmas gifts are in now. Shop early and we ship right away, so you are done before the rush.',
   'Shop Christmas gifts', '#b8322a', '#f6f2ea', '#1f2b24',
   '2026-10-01 00:00 America/Toronto', '2026-11-20 00:00 America/Toronto', '2026-12-26 00:00 America/Toronto', 20, true,
   'Christmas gifts in Canada — shop early', 'Christmas gift ideas for everyone on your list, hand-checked and shipped across Canada. Shop early and skip the rush.',
   '[{"q":"Can I buy Christmas gifts now?","a":"Yes. Christmas gifts are available to order now and ship right away, so they arrive well before the holidays."},{"q":"What is the last day to order for Christmas?","a":"For standard shipping within Canada, order by December 15. Express shipping gives you a few more days."}]'),
  ('black-friday', 'Black Friday', 'black_friday', null, 'Black Friday',
   'The best gifts, better prices.', 'Our biggest weekend of the year.', null, null,
   'Shop the deals', '#111111', '#f4f1ea', '#111111',
   null, '2026-11-27 00:00 America/Toronto', '2026-12-01 00:00 America/Toronto', 30, false,
   null, null, '[]'),
  ('valentines-day', 'Valentine''s Day', 'valentines', 'valentines-day', 'Valentine''s Day',
   'Say it with something they''ll keep.', 'Romantic and sweet gifts for partners, friends and galentines.',
   null, 'Valentine''s gifts are in. Order early and it ships right away.',
   'Shop Valentine''s gifts', '#c2185b', '#fdf0f3', '#3a1420',
   '2027-01-15 00:00 America/Toronto', '2027-02-01 00:00 America/Toronto', '2027-02-15 00:00 America/Toronto', 10, true,
   'Valentine''s Day gifts in Canada', 'Valentine''s Day gift ideas for him, her and everyone you love, shipped across Canada.', '[]'),
  ('mothers-day', 'Mother''s Day', 'mothers_day', 'mothers-day', 'Mother''s Day',
   'For the one who does it all.', 'Gifts that say thank you, beautifully.', null, null,
   'Shop Mother''s Day', '#b05a7a', '#fbf3f1', '#33202a',
   null, '2027-04-20 00:00 America/Toronto', '2027-05-10 00:00 America/Toronto', 10, true,
   'Mother''s Day gifts in Canada', 'Thoughtful Mother''s Day gifts, hand-checked and shipped across Canada.', '[]'),
  ('fathers-day', 'Father''s Day', 'fathers_day', 'fathers-day', 'Father''s Day',
   'Gifts dad will actually use.', 'Good-looking, useful things for the dads in your life.', null, null,
   'Shop Father''s Day', '#2f5d7c', '#f1f4f5', '#1b2630',
   null, '2027-06-01 00:00 America/Toronto', '2027-06-21 00:00 America/Toronto', 10, true,
   'Father''s Day gifts in Canada', 'Useful, well-made Father''s Day gifts shipped across Canada.', '[]');

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'svc\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
