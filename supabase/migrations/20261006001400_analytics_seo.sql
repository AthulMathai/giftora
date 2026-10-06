-- First-party analytics (spec §58–59) and the SEO checklist (§48).
--
-- The storefront sends small batches of events to its own /api/t route, which writes them
-- here through svc_track (service role only). No IP addresses or user agents are stored;
-- visitors are a random first-party cookie id.

create table internal.analytics_events (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  event         text not null check (event in ('page_view', 'product_view', 'search', 'add_to_cart',
                                                'begin_checkout', 'campaign_view', 'sign_up')),
  visitor_id    text not null check (visitor_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  session_id    text not null check (session_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  user_id       uuid,
  path          text check (length(path) <= 512),
  referrer_host text check (length(referrer_host) <= 255),
  utm_source    text check (length(utm_source) <= 100),
  utm_medium    text check (length(utm_medium) <= 100),
  utm_campaign  text check (length(utm_campaign) <= 100),
  device        text check (device in ('mobile', 'tablet', 'desktop')),
  product_id    uuid,
  variant_id    uuid,
  order_id      uuid,
  campaign_slug text check (length(campaign_slug) <= 100),
  query         text check (length(query) <= 200),
  results       int,
  value_cents   bigint
);
create index analytics_events_time_idx on internal.analytics_events (occurred_at);
create index analytics_events_event_idx on internal.analytics_events (event, occurred_at);
create index analytics_events_session_idx on internal.analytics_events (session_id, id);
create index analytics_events_product_idx on internal.analytics_events (product_id, occurred_at) where product_id is not null;
create index analytics_events_order_idx on internal.analytics_events (order_id) where order_id is not null;

-- Accepts up to 25 events per call; anything malformed is skipped rather than failing the batch.
create or replace function public.svc_track(p_events jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  e   jsonb;
  n   int := 0;
begin
  if jsonb_typeof(p_events) <> 'array' then return 0; end if;
  for e in select * from jsonb_array_elements(p_events) limit 25 loop
    begin
      insert into internal.analytics_events (event, visitor_id, session_id, user_id, path, referrer_host,
                                             utm_source, utm_medium, utm_campaign, device, product_id, variant_id,
                                             order_id, campaign_slug, query, results, value_cents)
      values (e ->> 'event', e ->> 'visitor_id', e ->> 'session_id', nullif(e ->> 'user_id', '')::uuid,
              left(e ->> 'path', 512), left(lower(e ->> 'referrer_host'), 255),
              left(lower(e ->> 'utm_source'), 100), left(lower(e ->> 'utm_medium'), 100), left(lower(e ->> 'utm_campaign'), 100),
              e ->> 'device', nullif(e ->> 'product_id', '')::uuid, nullif(e ->> 'variant_id', '')::uuid,
              nullif(e ->> 'order_id', '')::uuid, left(e ->> 'campaign_slug', 100),
              left(lower(btrim(e ->> 'query')), 200), (e ->> 'results')::int, (e ->> 'value_cents')::bigint);
      n := n + 1;
    exception when others then
      null;  -- bad event: skip it
    end;
  end loop;
  return n;
end;
$$;

-- One call returns everything the Analytics screen shows for a date range (Toronto dates).
create or replace function public.svc_analytics(p_actor uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finance boolean;
  v_start   timestamptz;
  v_end     timestamptz;
  v_result  jsonb;
begin
  perform internal.act_as(p_actor, 'analytics.view');
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Pick a range of up to a year' using errcode = 'P0030';
  end if;
  v_finance := internal.has_permission(p_actor, 'finance.view');
  v_start := p_from::timestamp at time zone 'America/Toronto';
  v_end   := (p_to + 1)::timestamp at time zone 'America/Toronto';

  create temp table if not exists pg_temp._ev on commit drop as
    select * from internal.analytics_events limit 0;
  truncate pg_temp._ev;
  insert into pg_temp._ev select * from internal.analytics_events where occurred_at >= v_start and occurred_at < v_end;

  create temp table if not exists pg_temp._ord on commit drop as
    select o.id, o.source, o.total_cents, o.paid_at, o.status from public.orders o limit 0;
  truncate pg_temp._ord;
  insert into pg_temp._ord select o.id, o.source, o.total_cents, o.paid_at, o.status
    from public.orders o where o.paid_at >= v_start and o.paid_at < v_end;

  with sess as (
    select session_id,
           bool_or(event = 'product_view') as viewed,
           bool_or(event = 'add_to_cart') as added,
           bool_or(event = 'begin_checkout') as checkout,
           bool_or(order_id in (select id from pg_temp._ord)) as purchased
      from pg_temp._ev group by session_id
  ), first_touch as (
    select distinct on (session_id) session_id,
           coalesce(nullif(utm_source, ''), nullif(referrer_host, ''), 'direct') as source, device
      from pg_temp._ev order by session_id, id
  ), web_orders as (
    select count(*) as n from pg_temp._ord where source = 'web'
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'totals', jsonb_build_object(
      'visitors', (select count(distinct visitor_id) from pg_temp._ev),
      'sessions', (select count(*) from sess),
      'page_views', (select count(*) from pg_temp._ev where event = 'page_view'),
      'product_views', (select count(*) from pg_temp._ev where event = 'product_view'),
      'add_to_carts', (select count(*) from pg_temp._ev where event = 'add_to_cart'),
      'checkouts', (select count(*) from sess where checkout),
      'orders', (select count(*) from pg_temp._ord),
      'web_orders', (select n from web_orders),
      'gross_sales_cents', (select coalesce(sum(total_cents), 0) from pg_temp._ord),
      'refunds_cents', (select coalesce(sum(r.amount_cents), 0) from internal.refunds r
                         where r.status = 'succeeded' and r.created_at >= v_start and r.created_at < v_end),
      'avg_order_cents', (select coalesce(round(avg(total_cents)), 0) from pg_temp._ord),
      'conversion_rate', case when (select count(*) from sess) > 0
                              then round((select count(*) from sess where purchased)::numeric / (select count(*) from sess), 4) end,
      'gross_profit_cents', case when v_finance then
         (select coalesce(sum(s.expected_profit_cents), 0) from internal.order_financial_snapshots s where s.order_id in (select id from pg_temp._ord))
         - (select coalesce(sum(a.amount_cents), 0) from internal.order_adjustments a where a.order_id in (select id from pg_temp._ord)) end),
    'funnel', jsonb_build_array(
      jsonb_build_object('step', 'Visited', 'sessions', (select count(*) from sess)),
      jsonb_build_object('step', 'Viewed a gift', 'sessions', (select count(*) from sess where viewed)),
      jsonb_build_object('step', 'Added to cart', 'sessions', (select count(*) from sess where added)),
      jsonb_build_object('step', 'Started checkout', 'sessions', (select count(*) from sess where checkout)),
      jsonb_build_object('step', 'Bought', 'sessions', (select count(*) from sess where purchased))),
    'daily', (
      select jsonb_agg(jsonb_build_object(
               'date', d::date,
               'visitors', (select count(distinct visitor_id) from pg_temp._ev
                             where (occurred_at at time zone 'America/Toronto')::date = d::date),
               'orders', (select count(*) from pg_temp._ord where (paid_at at time zone 'America/Toronto')::date = d::date),
               'sales_cents', (select coalesce(sum(total_cents), 0) from pg_temp._ord
                                where (paid_at at time zone 'America/Toronto')::date = d::date)) order by d)
        from generate_series(p_from, p_to, interval '1 day') d),
    'top_products', coalesce((
      select jsonb_agg(t order by t.sales_cents desc, t.views desc) from (
        select p.id, p.name, p.slug,
               (select count(*) from pg_temp._ev e where e.product_id = p.id and e.event = 'product_view') as views,
               (select count(*) from pg_temp._ev e where e.product_id = p.id and e.event = 'add_to_cart') as add_to_carts,
               coalesce((select sum(oi.quantity) from public.order_items oi join public.product_variants v on v.id = oi.variant_id
                          where v.product_id = p.id and oi.order_id in (select id from pg_temp._ord)), 0) as units,
               coalesce((select sum(oi.line_total_cents) from public.order_items oi join public.product_variants v on v.id = oi.variant_id
                          where v.product_id = p.id and oi.order_id in (select id from pg_temp._ord)), 0) as sales_cents
          from public.products p
         where exists (select 1 from pg_temp._ev e where e.product_id = p.id)
            or exists (select 1 from public.order_items oi join public.product_variants v on v.id = oi.variant_id
                        where v.product_id = p.id and oi.order_id in (select id from pg_temp._ord))
         order by 6 desc, 4 desc
         limit 15) t), '[]'::jsonb),
    'searches', coalesce((
      select jsonb_agg(s order by s.count desc) from (
        select query, count(*) as count, round(avg(results), 1) as avg_results,
               count(*) filter (where results = 0) as no_results
          from pg_temp._ev where event = 'search' and coalesce(query, '') <> ''
         group by query order by count(*) desc limit 20) s), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(s order by s.sessions desc) from (
        select f.source, count(*) as sessions, count(*) filter (where ss.purchased) as purchases
          from first_touch f join sess ss using (session_id)
         group by f.source order by count(*) desc limit 15) s), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_object_agg(coalesce(device, 'unknown'), n) from (
        select device, count(*) as n from first_touch group by device) d), '{}'::jsonb),
    'order_sources', coalesce((
      select jsonb_agg(s order by s.orders desc) from (
        select source, count(*) as orders, sum(total_cents) as sales_cents from pg_temp._ord group by source) s), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(c order by c.views desc) from (
        select campaign_slug as slug, count(*) as views, count(distinct visitor_id) as visitors
          from pg_temp._ev where event = 'campaign_view' and campaign_slug is not null
         group by campaign_slug) c), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- SEO checklist: what's missing on live products, categories and seasons.
create or replace function public.svc_seo_audit(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.act_as(p_actor, 'catalog.view');
  return jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(x order by x ->> 'name') from (
        select jsonb_build_object('id', p.id, 'name', p.name, 'slug', p.slug, 'issues', array_remove(array[
          case when p.seo_title is null then 'No SEO title (the product name is used)' end,
          case when p.seo_title is not null and length(p.seo_title) > 60 then 'SEO title is over 60 characters' end,
          case when p.seo_description is null then 'No meta description' end,
          case when length(p.seo_description) > 160 then 'Meta description is over 160 characters' end,
          case when length(coalesce(p.description, '')) < 120 then 'Description is short (under 120 characters)' end,
          case when not exists (select 1 from public.product_images i where i.product_id = p.id) then 'No photos' end,
          case when exists (select 1 from public.product_images i where i.product_id = p.id and coalesce(btrim(i.alt_text), '') = '')
               then 'A photo has no alt text' end,
          case when cardinality(p.occasions) = 0 then 'No occasions (it won''t appear on occasion pages)' end,
          case when cardinality(p.recipients) = 0 then 'No recipients (who it''s for)' end,
          case when p.category_id is null then 'No category' end
        ], null)) as x
          from public.products p where p.status in ('active', 'seasonal')
      ) s where jsonb_array_length(x -> 'issues') > 0), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'issues', array_remove(array[
          case when coalesce(c.description, '') = '' then 'No description' end,
          case when c.seo_description is null then 'No meta description' end], null)) order by c.name)
        from public.categories c
       where c.is_visible and (coalesce(c.description, '') = '' or c.seo_description is null)), '[]'::jsonb),
    'live_products', (select count(*) from public.products where status in ('active', 'seasonal')));
end;
$$;

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
