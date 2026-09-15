begin;

-- Keep the store subscription identity separate from allowance counters. The
-- relay is the only caller: end-user JWTs never read or write billing records.
create table public.billing_subscriptions (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revenuecat_customer_id text not null check (length(revenuecat_customer_id) between 1 and 512),
  subscription_id text not null check (length(subscription_id) between 1 and 512),
  entitlement_id text not null check (length(entitlement_id) between 1 and 128),
  product_id text not null check (length(product_id) between 1 and 256),
  store text check (store is null or length(store) between 1 and 64),
  active boolean not null default false,
  period_start timestamptz,
  period_end timestamptz,
  checked_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_start is null or period_end is null or period_end > period_start)
);

create index billing_subscriptions_subscription_id_idx
  on public.billing_subscriptions(subscription_id);

alter table public.billing_subscriptions enable row level security;
revoke all on table public.billing_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.billing_subscriptions to service_role;

-- Replace the legacy boolean-only reconciliation with one atomic write that
-- keeps the verified RevenueCat/store identity correlated with the allowance.
drop function public.apply_entitlement(uuid, timestamptz, timestamptz, timestamptz, boolean);

create function public.apply_entitlement(
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
  previous public.allowances;
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

  insert into public.allowances(owner_id) values (p_owner) on conflict do nothing;
  select * into previous
  from public.allowances
  where owner_id = p_owner
  for update;

  -- Ignore an older REST response or delayed webhook reconciliation in full.
  if previous.entitlement_checked_at is not null
     and previous.entitlement_checked_at >= p_checked then
    return;
  end if;

  update public.allowances
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
    insert into public.billing_subscriptions (
      owner_id, revenuecat_customer_id, subscription_id, entitlement_id,
      product_id, store, active, period_start, period_end, checked_at
    ) values (
      p_owner, p_revenuecat_customer_id, p_subscription_id, p_entitlement_id,
      p_product_id, nullif(p_store, ''), p_paid, p_start, p_end, p_checked
    )
    on conflict (owner_id) do update
    set revenuecat_customer_id = excluded.revenuecat_customer_id,
        subscription_id = excluded.subscription_id,
        entitlement_id = excluded.entitlement_id,
        product_id = excluded.product_id,
        store = excluded.store,
        active = excluded.active,
        period_start = excluded.period_start,
        period_end = excluded.period_end,
        checked_at = excluded.checked_at,
        updated_at = now()
    where public.billing_subscriptions.checked_at < excluded.checked_at;
  else
    update public.billing_subscriptions
    set active = false,
        checked_at = p_checked,
        updated_at = now()
    where owner_id = p_owner and checked_at < p_checked;
  end if;
end;
$$;

revoke all on function public.apply_entitlement(
  uuid, timestamptz, timestamptz, timestamptz, boolean,
  text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.apply_entitlement(
  uuid, timestamptz, timestamptz, timestamptz, boolean,
  text, text, text, text, text
) to service_role;

-- Return a single consistent usage snapshot. Only the relay can invoke this;
-- it derives p_owner from the validated Supabase JWT.
create function public.account_usage(p_owner uuid)
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
        from public.usage_ledger l
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
    'subscription', case when s.owner_id is null then null else jsonb_build_object(
      'id', s.subscription_id,
      'customerId', s.revenuecat_customer_id,
      'entitlementId', s.entitlement_id,
      'productId', s.product_id,
      'store', s.store,
      'active', s.active,
      'checkedAt', s.checked_at
    ) end
  )
  from public.commercial_config c
  left join public.allowances a on a.owner_id = p_owner
  left join public.billing_subscriptions s on s.owner_id = p_owner
  where c.singleton;
$$;

revoke all on function public.account_usage(uuid) from public, anon, authenticated;
grant execute on function public.account_usage(uuid) to service_role;

commit;
