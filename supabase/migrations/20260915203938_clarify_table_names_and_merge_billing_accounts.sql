begin;

-- Deploy with the matching desktop app and relay. PostgREST upserts require
-- real tables and unique constraints; legacy-name views are not compatible.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.sessions, public.segments, public.session_summaries,
  public.commercial_config, public.allowances, public.billing_subscriptions,
  public.usage_ledger, public.billing_events in access exclusive mode;

alter table public.sessions rename to caption_sessions;
alter table public.segments rename to caption_segments;
alter table public.session_summaries rename to caption_summaries;
alter table public.commercial_config rename to billing_settings;
alter table public.usage_ledger rename to usage_reservations;
alter table public.billing_events rename to billing_webhook_events;
alter table public.allowances rename to billing_accounts;

-- One billing account per Auth user: counters and the optional most recently
-- verified subscription share the same row lock. Free accounts have no identity.
-- Keep the provider snapshot timestamps/period distinct from allowance state:
-- a revoked entitlement can retain its last known subscription identity.
alter table public.billing_accounts
  add column revenuecat_customer_id text check (length(revenuecat_customer_id) between 1 and 512),
  add column subscription_id text check (length(subscription_id) between 1 and 512),
  add column entitlement_id text check (length(entitlement_id) between 1 and 128),
  add column product_id text check (length(product_id) between 1 and 256),
  add column store text check (store is null or length(store) between 1 and 64),
  add column subscription_active boolean,
  add column subscription_period_start timestamptz,
  add column subscription_period_end timestamptz,
  add column subscription_checked_at timestamptz,
  add column subscription_created_at timestamptz,
  add column subscription_updated_at timestamptz,
  add constraint billing_accounts_subscription_period_check check (
    subscription_period_start is null or subscription_period_end is null
    or subscription_period_end > subscription_period_start
  ),
  add constraint billing_accounts_subscription_identity_check check (
    (subscription_id is null and revenuecat_customer_id is null
      and entitlement_id is null and product_id is null and store is null
      and subscription_active is null and subscription_period_start is null
      and subscription_period_end is null and subscription_checked_at is null
      and subscription_created_at is null and subscription_updated_at is null)
    or (subscription_id is not null and revenuecat_customer_id is not null
      and entitlement_id is not null and product_id is not null
      and subscription_active is not null and subscription_checked_at is not null
      and subscription_created_at is not null and subscription_updated_at is not null)
  );

-- Preserve subscription-only rows too, without granting an allowance that the
-- old allowance table did not contain.
insert into public.billing_accounts(owner_id)
select owner_id from public.billing_subscriptions on conflict do nothing;

update public.billing_accounts a
set revenuecat_customer_id = s.revenuecat_customer_id,
    subscription_id = s.subscription_id,
    entitlement_id = s.entitlement_id,
    product_id = s.product_id,
    store = s.store,
    subscription_active = s.active,
    subscription_period_start = s.period_start,
    subscription_period_end = s.period_end,
    subscription_checked_at = s.checked_at,
    subscription_created_at = s.created_at,
    subscription_updated_at = s.updated_at
from public.billing_subscriptions s where a.owner_id = s.owner_id;

-- Abort the entire transaction if any copied value differs before dropping
-- the redundant table. Existing counters were retained by the table rename.
do $$
begin
  if exists (
    select owner_id, revenuecat_customer_id, subscription_id, entitlement_id,
      product_id, store, active, period_start, period_end, checked_at, created_at, updated_at
    from public.billing_subscriptions
    except
    select owner_id, revenuecat_customer_id, subscription_id, entitlement_id,
      product_id, store, subscription_active, subscription_period_start,
      subscription_period_end, subscription_checked_at, subscription_created_at,
      subscription_updated_at
    from public.billing_accounts where subscription_id is not null
  ) then
    raise exception 'subscription consolidation did not preserve all records';
  end if;
end;
$$;

create index billing_accounts_subscription_id_idx
  on public.billing_accounts(subscription_id) where subscription_id is not null;

create or replace function private.reject_deleted_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is not null and new.owner_id <> auth.uid() then
  raise exception 'history owner mismatch';
 end if;
 perform 1 from public.caption_sessions where id = new.session_id and owner_id = new.owner_id for update;
 if exists(select 1 from public.caption_sessions where id = new.session_id and owner_id = new.owner_id and deleted_at is not null) then
  raise exception 'session deleted';
 end if;
 return new;
end $$;

create or replace function private.delete_history_session(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid();
begin
 if owner is null then raise exception 'sign-in required'; end if;
 update public.caption_sessions set deleted_at = now() where id = p_id and owner_id = owner;
 delete from public.caption_segments where session_id = p_id and owner_id = owner;
end $$;

create or replace function public.reserve_usage(
  p_owner uuid,
  p_session uuid,
  p_reservation integer,
  p_seconds integer
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  a public.billing_accounts;
  c public.billing_settings;
  remaining integer;
  charge integer;
begin
  if p_seconds not between 1 and 15 or p_reservation < 0 then
    raise exception 'invalid reservation';
  end if;

  insert into public.billing_accounts(owner_id) values(p_owner) on conflict do nothing;
  select * into a from public.billing_accounts where owner_id = p_owner for update;

  select seconds into charge
  from public.usage_reservations
  where owner_id = p_owner
    and session_id = p_session
    and reservation = p_reservation;
  if found then return charge; end if;

  if private.has_unlimited_usage(p_owner) then
    insert into public.usage_reservations(owner_id, session_id, reservation, seconds, billable)
    values(p_owner, p_session, p_reservation, p_seconds, false);
    return p_seconds;
  end if;

  select * into c from public.billing_settings where singleton;
  if a.paid and a.period_start <= now() and a.period_end > now() then
    remaining = c.monthly_seconds - a.used_seconds;
  else
    remaining = c.free_seconds - a.free_used_seconds;
  end if;
  charge = least(p_seconds, greatest(0, remaining));
  if charge = 0 then return 0; end if;

  if a.paid and a.period_start <= now() and a.period_end > now() then
    update public.billing_accounts set used_seconds = used_seconds + charge where owner_id = p_owner;
  else
    update public.billing_accounts set free_used_seconds = free_used_seconds + charge where owner_id = p_owner;
  end if;
  insert into public.usage_reservations(owner_id, session_id, reservation, seconds)
  values(p_owner, p_session, p_reservation, charge);
  return charge;
end;
$$;

alter function public.invalidate_session_summary() set schema private;

create or replace function private.invalidate_session_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and
    new.source_text is not distinct from old.source_text and
    new.state is not distinct from old.state and
    new.sequence is not distinct from old.sequence and
    new.start_ms is not distinct from old.start_ms and
    new.end_ms is not distinct from old.end_ms then
    return new;
  end if;
  if tg_op = 'DELETE' then
    delete from public.caption_summaries
      where session_id = old.session_id and owner_id = old.owner_id;
    return old;
  end if;
  delete from public.caption_summaries
    where session_id = new.session_id and owner_id = new.owner_id;
  return new;
end;
$$;

create or replace function public.apply_entitlement(
  p_owner uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_checked timestamptz,
  p_paid boolean,
  p_revenuecat_customer_id text,
  p_subscription_id text,
  p_entitlement_id text,
  p_product_id text,
  p_store text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous public.billing_accounts;
begin
  if p_checked is null then
    raise exception 'entitlement check timestamp required';
  end if;
  if p_start is not null and p_end is not null and p_end <= p_start then
    raise exception 'invalid entitlement period';
  end if;
  if p_paid and (
    p_start is null or p_end is null or p_end <= now()
    or nullif(p_revenuecat_customer_id, '') is null
    or nullif(p_subscription_id, '') is null
    or nullif(p_entitlement_id, '') is null
    or nullif(p_product_id, '') is null
  ) then
    raise exception 'active entitlement requires verified subscription identity';
  end if;

  insert into public.billing_accounts(owner_id) values (p_owner) on conflict do nothing;
  select * into previous
  from public.billing_accounts
  where owner_id = p_owner
  for update;

  -- Ignore an older REST response or delayed webhook reconciliation in full.
  if previous.entitlement_checked_at is not null
     and previous.entitlement_checked_at >= p_checked then
    return;
  end if;

  update public.billing_accounts
  set used_seconds = case
        when p_paid
          and p_start is distinct from previous.period_start
          and p_start > coalesce(previous.period_start, 'epoch'::timestamptz)
        then 0
        else previous.used_seconds
      end,
      paid = p_paid,
      period_start = coalesce(p_start, previous.period_start),
      period_end = coalesce(p_end, previous.period_end),
      entitlement_checked_at = p_checked
  where owner_id = p_owner;

  if nullif(p_subscription_id, '') is not null then
    update public.billing_accounts
    set revenuecat_customer_id = p_revenuecat_customer_id,
        subscription_id = p_subscription_id,
        entitlement_id = p_entitlement_id,
        product_id = p_product_id,
        store = nullif(p_store, ''),
        subscription_active = p_paid,
        subscription_period_start = p_start,
        subscription_period_end = p_end,
        subscription_checked_at = p_checked,
        subscription_created_at = coalesce(subscription_created_at, now()),
        subscription_updated_at = now()
    where owner_id = p_owner
      and (subscription_checked_at is null or subscription_checked_at < p_checked);
  else
    update public.billing_accounts
    set subscription_active = false,
        subscription_checked_at = p_checked,
        subscription_updated_at = now()
    where owner_id = p_owner and subscription_id is not null
      and subscription_checked_at < p_checked;
  end if;
end;
$$;

create or replace function public.account_usage(p_owner uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'active', coalesce(a.paid and a.period_start <= now() and a.period_end > now(), false),
    'unlimited', private.has_unlimited_usage(p_owner),
    'usedSeconds', case
      when private.has_unlimited_usage(p_owner) then coalesce((
        select sum(l.seconds)::integer
        from public.usage_reservations l
        where l.owner_id = p_owner and not l.billable
      ), 0)
      when coalesce(a.paid and a.period_start <= now() and a.period_end > now(), false)
        then coalesce(a.used_seconds, 0)
      else coalesce(a.free_used_seconds, 0)
    end,
    'includedSeconds', case
      when private.has_unlimited_usage(p_owner) then null
      when coalesce(a.paid and a.period_start <= now() and a.period_end > now(), false)
        then c.monthly_seconds
      else c.free_seconds
    end,
    'remainingSeconds', case
      when private.has_unlimited_usage(p_owner) then null
      when coalesce(a.paid and a.period_start <= now() and a.period_end > now(), false)
        then greatest(0, c.monthly_seconds - coalesce(a.used_seconds, 0))
      else greatest(0, c.free_seconds - coalesce(a.free_used_seconds, 0))
    end,
    'periodStart', a.period_start,
    'periodEnd', a.period_end,
    'subscription', case when a.subscription_id is null then null else jsonb_build_object(
      'id', a.subscription_id,
      'customerId', a.revenuecat_customer_id,
      'entitlementId', a.entitlement_id,
      'productId', a.product_id,
      'store', a.store,
      'active', a.subscription_active,
      'checkedAt', a.subscription_checked_at
    ) end
  )
  from public.billing_settings c
  left join public.billing_accounts a on a.owner_id = p_owner
  where c.singleton;
$$;

drop table public.billing_subscriptions;

-- Renames preserve RLS and grants. Explicitly close PUBLIC as well, so no
-- inherited/default grants can expose billing records or client history.
revoke all on public.billing_accounts, public.billing_settings,
  public.usage_reservations, public.billing_webhook_events from public, anon, authenticated;
grant select, insert, update, delete on public.billing_accounts,
  public.billing_settings, public.usage_reservations, public.billing_webhook_events to service_role;
revoke all on public.caption_sessions, public.caption_segments,
  public.caption_summaries from public, anon;

-- Give constraints, indexes and policies the same discoverable table prefix.
do $$
declare
  entry record;
  old_prefix text;
  new_prefix text;
  item record;
  new_name text;
begin
  for entry in select * from (values
    ('sessions', 'caption_sessions'), ('segments', 'caption_segments'),
    ('session_summaries', 'caption_summaries'), ('allowances', 'billing_accounts'),
    ('commercial_config', 'billing_settings'), ('usage_ledger', 'usage_reservations'),
    ('billing_events', 'billing_webhook_events')
  ) as names(old_name, new_name) loop
    old_prefix := entry.old_name;
    new_prefix := entry.new_name;
    for item in select conname from pg_constraint
      where conrelid = format('public.%I', new_prefix)::regclass
        and starts_with(conname, old_prefix || '_') loop
      new_name := new_prefix || substr(item.conname, length(old_prefix) + 1);
      execute format('alter table public.%I rename constraint %I to %I',
        new_prefix, item.conname, new_name);
    end loop;
    for item in select indexname from pg_indexes
      where schemaname = 'public' and tablename = new_prefix
        and starts_with(indexname, old_prefix || '_') loop
      new_name := new_prefix || substr(item.indexname, length(old_prefix) + 1);
      execute format('alter index public.%I rename to %I', item.indexname, new_name);
    end loop;
  end loop;
end;
$$;

alter policy read_sessions on public.caption_sessions rename to caption_sessions_select_owner;
alter policy insert_sessions on public.caption_sessions rename to caption_sessions_insert_owner;
alter policy owner_segments on public.caption_segments rename to caption_segments_owner;
alter policy "Users read their session summaries" on public.caption_summaries rename to caption_summaries_select_owner;
alter policy "Users delete their session summaries" on public.caption_summaries rename to caption_summaries_delete_owner;

comment on table public.caption_sessions is 'Saved caption sessions owned by an Auth user. deleted_at is a permanent tombstone against offline replay.';
comment on table public.caption_segments is 'Ordered source and translated caption text, with revision protection, belonging to one saved session.';
comment on table public.caption_summaries is 'One replaceable AI summary per saved caption session. Only the relay can create or update it.';
comment on table public.billing_accounts is 'One account per Auth user: allowance counters plus optional verified subscription identity. Service role only.';
comment on table public.billing_settings is 'Singleton product settings: free and paid allowance limits, session limits, entitlement and pricing configuration.';
comment on table public.usage_reservations is 'Idempotent speech usage reservations in seconds, keyed by owner, live session ID and reservation number. Survives history deletion.';
comment on table public.billing_webhook_events is 'Successfully processed RevenueCat webhook IDs, retained to deduplicate retries. Not a payment ledger.';
comment on column public.billing_accounts.paid is 'Last reconciled entitlement state; paid access also requires the allowance period to contain the current time.';
comment on column public.billing_accounts.period_start is 'Start of the metered allowance period, which can be monthly even for an annual subscription.';
comment on column public.billing_accounts.used_seconds is 'Billable seconds reserved within the current paid allowance period.';
comment on column public.billing_accounts.free_used_seconds is 'Lifetime billable free seconds; does not reset when a subscription renews.';
comment on column public.billing_accounts.subscription_checked_at is 'Verification time of the retained subscription snapshot; may differ from entitlement_checked_at for migrated records.';
comment on column public.usage_reservations.session_id is 'Live relay session UUID, not a foreign key to saved caption history. Metering can happen without saved history.';
comment on column public.usage_reservations.reservation is 'Sequence number within a live session, used for retry deduplication.';

-- Store one caption document per session, with queryable metadata alongside it.
alter table public.caption_sessions
  add column transcript jsonb not null default '[]'::jsonb check (jsonb_typeof(transcript) = 'array'),
  add column summary jsonb check (summary is null or jsonb_typeof(summary) = 'object'),
  add column transcript_version bigint not null default 0,
  add column updated_at timestamptz not null default now(),
  add column segment_count integer not null default 0,
  add column duration_ms integer not null default 0,
  add column preview text not null default '',
  add column summary_title text generated always as (summary #>> '{content,title}') stored;

update public.caption_sessions s set
  transcript = coalesce((select jsonb_agg(to_jsonb(g) - 'owner_id' - 'session_id' order by g.sequence, g.id)
    from public.caption_segments g where g.session_id = s.id), '[]'::jsonb),
  summary = (select to_jsonb(m) - 'owner_id' from public.caption_summaries m where m.session_id = s.id),
  transcript_version = 1,
  segment_count = (select count(*) from public.caption_segments g where g.session_id = s.id),
  duration_ms = coalesce((select max(end_ms) from public.caption_segments g where g.session_id = s.id), 0),
  preview = coalesce((select left(source_text, 160) from public.caption_segments g where g.session_id = s.id order by sequence, id limit 1), '');

do $$
begin
  if exists (
    select to_jsonb(g) - 'owner_id' - 'session_id' as item, g.session_id from public.caption_segments g
    except
    select item, s.id from public.caption_sessions s cross join lateral jsonb_array_elements(s.transcript) item
  ) or exists (
    select to_jsonb(m) - 'owner_id', m.session_id from public.caption_summaries m
    except select summary, id from public.caption_sessions where summary is not null
  ) then raise exception 'caption document consolidation lost data'; end if;
end;
$$;

-- Clients can only read documents directly. Mutations go through owner-checked
-- functions so summary fields and deletion tombstones cannot be forged.
revoke all on public.caption_sessions from authenticated;
grant select on public.caption_sessions to authenticated;
drop policy caption_sessions_insert_owner on public.caption_sessions;

create or replace function private.delete_history_session(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid();
begin
  if owner is null then raise exception 'sign-in required'; end if;
  -- A deletion may arrive before the first offline batch. Insert a tombstone
  -- even for an unknown session so an in-flight batch cannot resurrect it.
  insert into public.caption_sessions(id, owner_id, source_language, target_language, deleted_at)
  values (p_id, owner, 'auto', 'auto', now()) on conflict (id) do nothing;
  update public.caption_sessions set deleted_at = coalesce(deleted_at, now()),
    transcript = '[]'::jsonb, summary = null, segment_count = 0, duration_ms = 0,
    preview = '', updated_at = now(), transcript_version = transcript_version + 1
  where id = p_id and owner_id = owner;
end;
$$;

-- This privileged implementation is intentionally private. The public wrapper
-- uses the caller's JWT; no owner ID is accepted from the payload.
create function private.sync_caption_session(p_id uuid, p_segments jsonb, p_started_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
  current_session public.caption_sessions;
  item jsonb;
  document jsonb;
  source_changed boolean := false;
begin
  if owner is null then raise exception 'sign-in required'; end if;
  if p_id is null or jsonb_typeof(p_segments) is distinct from 'array' then
    raise exception 'caption batch must be an array';
  end if;
  if jsonb_array_length(p_segments) not between 1 and 10000
     or octet_length(p_segments::text) > 16777216 then raise exception 'caption batch too large'; end if;
  for item in select value from jsonb_array_elements(p_segments) loop
    if jsonb_typeof(item) is distinct from 'object'
      or not (item ?& array['id','sequence','revision','start_ms','end_ms','source_language','target_language','source_text','translated_text','state'])
      or jsonb_typeof(item->'id') is distinct from 'string' or length(item->>'id') not between 1 and 512
      or jsonb_typeof(item->'source_text') is distinct from 'string' or length(item->>'source_text') > 8000
      or jsonb_typeof(item->'translated_text') is distinct from 'string' or length(item->>'translated_text') > 16000
      or jsonb_typeof(item->'source_language') is distinct from 'string'
      or not (item->>'source_language' = 'auto' or item->>'source_language' ~ '^[a-z]{2,3}(-[a-z]{2})?$')
      or jsonb_typeof(item->'target_language') is distinct from 'string'
      or not (item->>'target_language' = 'auto' or item->>'target_language' ~ '^[a-z]{2,3}(-[a-z]{2})?$')
      or jsonb_typeof(item->'state') is distinct from 'string'
      or item->>'state' not in ('pending','complete','translation-error')
      or jsonb_typeof(item->'sequence') is distinct from 'number' or item->>'sequence' !~ '^[0-9]+$'
      or jsonb_typeof(item->'revision') is distinct from 'number' or item->>'revision' !~ '^[0-9]+$'
      or jsonb_typeof(item->'start_ms') is distinct from 'number' or item->>'start_ms' !~ '^[0-9]+$'
      or jsonb_typeof(item->'end_ms') is distinct from 'number' or item->>'end_ms' !~ '^[0-9]+$'
    then raise exception 'invalid caption'; end if;
    if (item->>'revision')::integer < 1 or (item->>'sequence')::integer < 0
      or (item->>'start_ms')::integer < 0 or (item->>'end_ms')::integer < (item->>'start_ms')::integer
    then raise exception 'invalid caption timing or revision'; end if;
  end loop;

  insert into public.caption_sessions(id, owner_id, source_language, target_language, started_at)
  values (p_id, owner, p_segments->0->>'source_language', p_segments->0->>'target_language', coalesce(p_started_at, now()))
  on conflict (id) do nothing;
  select * into current_session from public.caption_sessions where id = p_id for update;
  if current_session.owner_id <> owner then raise exception 'history owner mismatch'; end if;
  if current_session.deleted_at is not null then return; end if;

  if (select count(distinct value->>'id') from jsonb_array_elements(p_segments))
    <> jsonb_array_length(p_segments) then raise exception 'duplicate caption ID'; end if;
  -- Set-based merge: one pass over each document, even for long recordings.
  with incoming as (
    select value->>'id' as id,
      jsonb_build_object('id',value->'id','sequence',value->'sequence','revision',value->'revision',
        'start_ms',value->'start_ms','end_ms',value->'end_ms','source_language',value->'source_language',
        'target_language',value->'target_language','source_text',value->'source_text',
        'translated_text',value->'translated_text','state',value->'state') as item
    from jsonb_array_elements(p_segments)
  ), existing as (
    select value->>'id' as id, value as item from jsonb_array_elements(current_session.transcript)
  ), merged as (
    select case
      when i.id is null then e.item
      when e.id is null then i.item
      when (i.item->>'revision')::integer < (e.item->>'revision')::integer then e.item
      when (i.item->>'revision')::integer = (e.item->>'revision')::integer
        and e.item->>'state' in ('complete','translation-error') and i.item->>'state' = 'pending' then e.item
      else i.item end as item
    from incoming i full join existing e on e.id = i.id
  )
  select coalesce(jsonb_agg(m.item order by (m.item->>'sequence')::integer, m.item->>'id'), '[]'::jsonb)
    into document from merged m;
  select
    (select jsonb_agg(jsonb_build_array(value->'id',value->'source_text',value->'state',value->'sequence',value->'start_ms',value->'end_ms')
      order by (value->>'sequence')::integer,value->>'id') from jsonb_array_elements(document))
    is distinct from
    (select jsonb_agg(jsonb_build_array(value->'id',value->'source_text',value->'state',value->'sequence',value->'start_ms',value->'end_ms')
      order by (value->>'sequence')::integer,value->>'id') from jsonb_array_elements(current_session.transcript))
    into source_changed;
  if jsonb_array_length(document) > 10000 or octet_length(document::text) > 16777216 then
    raise exception 'session transcript too large';
  end if;
  if document is distinct from current_session.transcript then
    update public.caption_sessions set transcript = document, updated_at = now(),
      transcript_version = transcript_version + case when source_changed then 1 else 0 end,
      summary = case when source_changed then null else summary end,
      segment_count = jsonb_array_length(document),
      duration_ms = coalesce((select max((value->>'end_ms')::integer) from jsonb_array_elements(document)), 0),
      preview = left(document->0->>'source_text', 160)
    where id = p_id;
  end if;
end;
$$;
revoke all on function private.sync_caption_session(uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function private.sync_caption_session(uuid,jsonb,timestamptz) to authenticated;
create function public.sync_caption_session(p_id uuid, p_segments jsonb, p_started_at timestamptz default null) returns void
language sql security invoker set search_path = '' as $$
  select private.sync_caption_session(p_id, p_segments, p_started_at);
$$;
revoke all on function public.sync_caption_session(uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.sync_caption_session(uuid,jsonb,timestamptz) to authenticated;

-- The relay writes summaries with a compare-and-set version in the same locked
-- row, closing the old gap between checking a transcript and saving its summary.
create function public.save_caption_summary(p_owner uuid, p_id uuid, p_version bigint, p_summary jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_session public.caption_sessions; result jsonb;
begin
  select * into current_session from public.caption_sessions where id=p_id and owner_id=p_owner for update;
  if not found or current_session.deleted_at is not null then raise exception 'session unavailable'; end if;
  if p_version is null or current_session.transcript_version <> p_version then raise exception 'transcript changed; generate again'; end if;
  if jsonb_typeof(p_summary) is distinct from 'object'
    or jsonb_typeof(p_summary->'content') is distinct from 'object'
    or octet_length((p_summary->'content')::text) > 65536
    or coalesce(length(p_summary->>'language'),0) not between 2 and 32
    or coalesce(length(p_summary->>'model'),0) not between 1 and 100
    or coalesce(p_summary->>'source_hash','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_summary->>'request_hash','') !~ '^[0-9a-f]{64}$'
  then raise exception 'invalid summary'; end if;
  result := jsonb_build_object('session_id',p_id,'language',p_summary->'language',
    'content',p_summary->'content','source_hash',p_summary->'source_hash','request_hash',p_summary->'request_hash',
    'model',p_summary->'model','created_at',coalesce(current_session.summary->'created_at',to_jsonb(now())),
    'updated_at',now());
  update public.caption_sessions set summary=result, updated_at=now() where id=p_id;
  return result;
end;
$$;
revoke all on function public.save_caption_summary(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_caption_summary(uuid,uuid,bigint,jsonb) to service_role;

drop table public.caption_segments;
drop table public.caption_summaries;
drop function public.guard_segment_revision();
drop function private.reject_deleted_history();
drop function private.invalidate_session_summary();

-- Existing (owner_id, started_at DESC) index serves owner history lists and
-- account deletion. The primary key serves document fetches; no JSON index is
-- needed because caption text is loaded as a whole, never searched server-side.
comment on table public.caption_sessions is 'One saved caption document per session: transcript and optional summary JSON with owner, language, timing and preview metadata. Owner reads; writes through sync_caption_session.';
comment on column public.caption_sessions.transcript is 'Ordered JSON array of caption chunks including source text, translation, timestamps and revision. Uploaded as a completed session document, with idempotent revision-aware merging for retries.';
comment on column public.caption_sessions.summary is 'Optional generated summary with language, model and source hashes. Written only by the relay; cleared on source changes.';
comment on column public.caption_sessions.transcript_version is 'Source-content version for atomic summary writes; unchanged by duplicate sync or translation-only updates.';

notify pgrst, 'reload schema';
commit;
