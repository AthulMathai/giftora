-- Platform: insert-only audit log, transactional outbox, system settings.

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table internal.audit_logs (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,                      -- null = system / background job
  action       text not null,             -- 'insert' | 'update' | 'delete' | domain verbs like 'label.override'
  object_type  text not null,             -- table or domain object, e.g. 'internal.pricing_rules'
  object_id    text,
  old_value    jsonb,
  new_value    jsonb,
  reason       text
);
create index audit_logs_object_idx on internal.audit_logs (object_type, object_id);
create index audit_logs_actor_idx on internal.audit_logs (actor_id, occurred_at desc);

-- Nobody, not even a super admin through the service role, may edit or delete history.
create or replace function internal.audit_logs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;
create trigger audit_logs_no_update before update or delete on internal.audit_logs
  for each row execute function internal.audit_logs_immutable();
create trigger audit_logs_no_truncate before truncate on internal.audit_logs
  for each statement execute function internal.audit_logs_immutable();

-- Who is acting? A signed-in user's JWT, or an actor id that server code sets for
-- the transaction with: select set_config('giftora.actor_id', '<uuid>', true);
create or replace function internal.current_actor()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    auth.uid(),
    nullif(current_setting('giftora.actor_id', true), '')::uuid
  );
$$;

create or replace function internal.write_audit(
  p_action text, p_object_type text, p_object_id text,
  p_old jsonb, p_new jsonb, p_reason text default null
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into internal.audit_logs (actor_id, action, object_type, object_id, old_value, new_value, reason)
  values (internal.current_actor(), p_action, p_object_type, p_object_id, p_old, p_new,
          coalesce(p_reason, nullif(current_setting('giftora.reason', true), '')));
$$;

-- Generic row-change trigger. Attach to any table whose changes must be audited.
create or replace function internal.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_id  text  := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'key', v_old ->> 'key',
                          v_new ->> 'user_id', v_old ->> 'user_id');
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  perform internal.write_audit(lower(tg_op), tg_table_schema || '.' || tg_table_name, v_id, v_old, v_new);
  return coalesce(new, old);
end;
$$;

create trigger staff_members_audit after insert or update or delete on internal.staff_members
  for each row execute function internal.audit_row_change();
create trigger role_permissions_audit after insert or update or delete on internal.role_permissions
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------------
-- Outbox: side effects (email, WhatsApp, label requests) are written in the same
-- transaction as the change that caused them, then delivered by the job runner.
-- ---------------------------------------------------------------------------
create table internal.outbox_events (
  id            bigint generated always as identity primary key,
  topic         text not null,           -- 'order.paid', 'notify.staff.new_order', ...
  payload       jsonb not null,
  created_at    timestamptz not null default now(),
  available_at  timestamptz not null default now(),
  attempts      int not null default 0,
  last_error    text,
  processed_at  timestamptz
);
create index outbox_pending_idx on internal.outbox_events (available_at)
  where processed_at is null;

create or replace function internal.enqueue(p_topic text, p_payload jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into internal.outbox_events (topic, payload) values (p_topic, p_payload) returning id;
$$;

-- Workers claim a batch without double-processing (SKIP LOCKED).
create or replace function internal.claim_outbox(p_limit int default 20)
returns setof internal.outbox_events
language sql
security definer
set search_path = ''
as $$
  update internal.outbox_events e
     set attempts = e.attempts + 1,
         available_at = now() + make_interval(secs => least(3600, 30 * power(2, e.attempts)::int))
   where e.id in (
     select id from internal.outbox_events
      where processed_at is null and available_at <= now() and attempts < 10
      order by id
      limit p_limit
      for update skip locked
   )
  returning e.*;
$$;

-- ---------------------------------------------------------------------------
-- System settings (key/value, audited)
-- ---------------------------------------------------------------------------
create table internal.system_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);
create trigger system_settings_updated_at before update on internal.system_settings
  for each row execute function internal.set_updated_at();
create trigger system_settings_audit after insert or update or delete on internal.system_settings
  for each row execute function internal.audit_row_change();

insert into internal.system_settings (key, value, description) values
  ('checkout.reservation_minutes', '15', 'How long a started checkout holds supplier stock'),
  ('orders.number_prefix', '"GFT-"', 'Prefix for human-facing order numbers'),
  ('notifications.staff_emails', '[]', 'Staff email addresses for new-order alerts'),
  ('notifications.staff_whatsapp', '[]', 'Staff WhatsApp numbers (E.164) for new-order alerts'),
  ('supply.stale_after_hours', '72', 'Supplier stock checked longer ago than this is treated as unavailable');
