-- Identity: customer profiles, addresses, staff roles and permissions.

-- ---------------------------------------------------------------------------
-- Customer profile (one per auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             extensions.citext not null,
  full_name         text,
  phone             text,
  marketing_opt_in  boolean not null default false,
  preferences       jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function internal.set_updated_at();

alter table public.profiles enable row level security;

create policy "profiles: owner reads" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles: owner updates" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Customers may not change their own email here (auth owns it).
revoke update on public.profiles from authenticated;
grant update (full_name, phone, marketing_opt_in, preferences) on public.profiles to authenticated;

-- Create the profile automatically when someone signs up.
create or replace function internal.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', null))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function internal.handle_new_user();

-- ---------------------------------------------------------------------------
-- Addresses
-- ---------------------------------------------------------------------------
create table public.addresses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  label         text,
  full_name     text not null,
  line1         text not null,
  line2         text,
  city          text not null,
  province      char(2) not null check (province in
                  ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  postal_code   text not null check (postal_code ~* '^[A-Z]\d[A-Z] ?\d[A-Z]\d$'),
  country       char(2) not null default 'CA' check (country = 'CA'),
  phone         text,
  is_default_shipping boolean not null default false,
  is_default_billing  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index addresses_user_idx on public.addresses (user_id);
create trigger addresses_updated_at before update on public.addresses
  for each row execute function internal.set_updated_at();

alter table public.addresses enable row level security;
create policy "addresses: owner all" on public.addresses
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Staff: roles, permissions, members (all internal)
-- ---------------------------------------------------------------------------
create table internal.permissions (
  key          text primary key,           -- e.g. 'finance.view'
  description  text not null
);

create table internal.roles (
  key          text primary key,           -- e.g. 'super_admin'
  name         text not null,
  description  text not null
);

create table internal.role_permissions (
  role_key        text not null references internal.roles (key) on delete cascade,
  permission_key  text not null references internal.permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

create table internal.staff_members (
  user_id      uuid primary key references auth.users (id) on delete restrict,
  role_key     text not null references internal.roles (key),
  display_name text not null,
  active       boolean not null default true,
  require_mfa  boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger staff_members_updated_at before update on internal.staff_members
  for each row execute function internal.set_updated_at();

insert into internal.permissions (key, description) values
  ('catalog.view',        'View products, variants, categories'),
  ('catalog.edit',        'Create and edit products and variants'),
  ('pricing.edit',        'Change pricing rules and margins'),
  ('finance.view',        'See supplier cost, profit and financial snapshots'),
  ('suppliers.view',      'View suppliers and supplier items'),
  ('suppliers.edit',      'Edit suppliers, supplier items and availability'),
  ('orders.view',         'View orders'),
  ('orders.edit',         'Change orders, cancel, add notes'),
  ('refunds.create',      'Issue refunds'),
  ('fulfillment.operate', 'Pick, sort, pack and ship'),
  ('fulfillment.override','Override scan, label and packing locks'),
  ('customers.view',      'View customer profiles and history'),
  ('marketing.edit',      'Campaigns, promotions, SEO and content'),
  ('analytics.view',      'Analytics and reports'),
  ('audit.view',          'Read the audit log'),
  ('staff.manage',        'Invite staff and change roles'),
  ('settings.edit',       'Change system settings');

insert into internal.roles (key, name, description) values
  ('super_admin',       'Super Admin',       'Full access'),
  ('inventory_manager', 'Inventory Manager', 'Products, suppliers, availability, acquisition'),
  ('order_manager',     'Order Manager',     'Orders and fulfillment'),
  ('fulfillment_staff', 'Fulfillment Staff', 'Picking, sorting, packing screens only'),
  ('marketing_manager', 'Marketing Manager', 'Campaigns, promotions, SEO, content'),
  ('customer_support',  'Customer Support',  'Customers, orders, returns, tickets'),
  ('analyst',           'Analyst',           'Analytics and reports, read-only');

insert into internal.role_permissions (role_key, permission_key)
select 'super_admin', key from internal.permissions;

insert into internal.role_permissions (role_key, permission_key) values
  ('inventory_manager','catalog.view'), ('inventory_manager','catalog.edit'),
  ('inventory_manager','pricing.edit'), ('inventory_manager','finance.view'),
  ('inventory_manager','suppliers.view'), ('inventory_manager','suppliers.edit'),
  ('inventory_manager','orders.view'),
  ('order_manager','catalog.view'), ('order_manager','orders.view'), ('order_manager','orders.edit'),
  ('order_manager','fulfillment.operate'), ('order_manager','fulfillment.override'),
  ('order_manager','customers.view'),
  ('fulfillment_staff','fulfillment.operate'),
  ('marketing_manager','catalog.view'), ('marketing_manager','marketing.edit'),
  ('marketing_manager','analytics.view'),
  ('customer_support','catalog.view'), ('customer_support','orders.view'),
  ('customer_support','customers.view'),
  ('analyst','catalog.view'), ('analyst','orders.view'), ('analyst','finance.view'),
  ('analyst','analytics.view'), ('analyst','customers.view');

-- Does the given user hold a permission? Used by staff server code and internal functions.
create or replace function internal.has_permission(p_user uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from internal.staff_members sm
    join internal.role_permissions rp on rp.role_key = sm.role_key
    where sm.user_id = p_user
      and sm.active
      and rp.permission_key = p_permission
  );
$$;

-- Lets the staff app ask "what can the signed-in user do?" without exposing the tables.
-- Returns nothing for customers.
create or replace function public.my_staff_permissions()
returns table (role_key text, permission_key text, require_mfa boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select sm.role_key, rp.permission_key, sm.require_mfa
  from internal.staff_members sm
  join internal.role_permissions rp on rp.role_key = sm.role_key
  where sm.user_id = auth.uid() and sm.active;
$$;

grant execute on function public.my_staff_permissions() to authenticated;
