begin;

-- Activate a conservative 600-minute monthly included allowance for paid
-- subscribers. Preserve any plan amount already configured by an operator.
update public.commercial_config
set monthly_seconds = 36000
where singleton and monthly_seconds = 0;

-- Unlimited access is derived from the verified Auth identity. It is never
-- accepted from a client claim or editable user metadata.
create or replace function private.has_unlimited_usage(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users
    where id = p_owner
      and lower(email) = any (array[
        'mtccool668@gmail.com',
        'mattdev727@gmail.com'
      ])
  );
$$;

revoke all on function private.has_unlimited_usage(uuid) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.has_unlimited_usage(uuid) to service_role;

alter table public.usage_ledger
  add column billable boolean not null default true;

create or replace function public.reserve_usage(
  p_owner uuid,
  p_session uuid,
  p_reservation integer,
  p_seconds integer
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  a allowances;
  c commercial_config;
  remaining integer;
  charge integer;
begin
  if p_seconds not between 1 and 15 or p_reservation < 0 then
    raise exception 'invalid reservation';
  end if;

  insert into allowances(owner_id) values(p_owner) on conflict do nothing;
  select * into a from allowances where owner_id = p_owner for update;

  select seconds into charge
  from usage_ledger
  where owner_id = p_owner
    and session_id = p_session
    and reservation = p_reservation;
  if found then return charge; end if;

  if private.has_unlimited_usage(p_owner) then
    insert into usage_ledger(owner_id, session_id, reservation, seconds, billable)
    values(p_owner, p_session, p_reservation, p_seconds, false);
    return p_seconds;
  end if;

  select * into c from commercial_config where singleton;
  if a.paid and a.period_start <= now() and a.period_end > now() then
    remaining = c.monthly_seconds - a.used_seconds;
  else
    remaining = c.free_seconds - a.free_used_seconds;
  end if;
  charge = least(p_seconds, greatest(0, remaining));
  if charge = 0 then return 0; end if;

  if a.paid and a.period_start <= now() and a.period_end > now() then
    update allowances set used_seconds = used_seconds + charge where owner_id = p_owner;
  else
    update allowances set free_used_seconds = free_used_seconds + charge where owner_id = p_owner;
  end if;
  insert into usage_ledger(owner_id, session_id, reservation, seconds)
  values(p_owner, p_session, p_reservation, charge);
  return charge;
end;
$$;

revoke all on function public.reserve_usage(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_usage(uuid, uuid, integer, integer) to service_role;

commit;
