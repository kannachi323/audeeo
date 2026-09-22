begin;
set local lock_timeout='5s';
-- Settle outstanding legacy sandbox leases using the old refund routing.
do $$ declare lease record; begin
 for lease in select id,owner_id,checkpoint_seconds from public.metered_usage_leases where environment='SANDBOX' and settled_at is null loop
  perform public.settle_metered_usage(lease.owner_id,lease.id,lease.checkpoint_seconds,true);
 end loop;
end $$;
-- Sandbox has its own lifetime free allowance and subscription counters.
-- All wallet and allowance operations serialize on the existing owner billing row.
create table public.sandbox_billing_accounts (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 active boolean not null default false,
 product_id text, subscription_id text,
 period_start timestamptz, period_end timestamptz,
 checked_at timestamptz not null default '-infinity',
 used_seconds integer not null default 0 check(used_seconds>=0),
 free_used_seconds integer not null default 0 check(free_used_seconds>=0)
);
alter table public.sandbox_billing_accounts enable row level security;
revoke all on public.sandbox_billing_accounts from public,anon,authenticated;
grant select,insert,update on public.sandbox_billing_accounts to service_role;

create function public.apply_sandbox_entitlement(p_owner uuid,p_active boolean,p_product text,p_subscription text,
 p_start timestamptz,p_end timestamptz,p_checked timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_checked is null or (p_active and (p_start is null or p_end is null or p_end<=p_start or coalesce(p_subscription,'')='' or coalesce(p_product,'')='')) then
  raise exception 'invalid sandbox subscription';
 end if;
 insert into public.billing_accounts(owner_id) values(p_owner) on conflict do nothing;
 perform 1 from public.billing_accounts where owner_id=p_owner for update;
 insert into public.sandbox_billing_accounts(owner_id) values(p_owner) on conflict do nothing;
 -- Reconciliation is idempotent; an old receipt cannot reset a newer allowance.
 update public.sandbox_billing_accounts set
  active=p_active, checked_at=p_checked,
  used_seconds=case when p_active and (period_start is null or p_start>period_start) then 0 else used_seconds end,
  product_id=case when p_active then p_product else product_id end,
  subscription_id=case when p_active then p_subscription else subscription_id end,
  period_start=case when p_active then p_start else period_start end,
  period_end=case when p_active then p_end else period_end end
 where owner_id=p_owner and checked_at<=p_checked
  and (not p_active or period_start is null or p_start>=period_start);
end $$;

create function public.sandbox_account_usage(p_owner uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with account as (
  select coalesce(a.active and a.period_start<=now() and a.period_end>now(),false) paid,
   coalesce(a.used_seconds,0) used, coalesce(a.free_used_seconds,0) free_used,
   a.period_start,a.period_end,a.product_id,c.monthly_seconds,c.free_seconds
  from public.billing_settings c left join public.sandbox_billing_accounts a on a.owner_id=p_owner where c.singleton
 ), wallet as (
  select coalesce(sum(remaining_seconds) filter(where refunded_at is null),0) seconds,coalesce(max(id),0) revision
  from public.minute_pack_purchases where owner_id=p_owner and environment='SANDBOX'
 )
 select jsonb_build_object(
  'active',paid,'unlimited',false,'usedSeconds',case when paid then used else free_used end,
  'includedSeconds',case when paid then monthly_seconds else free_seconds end,
  'remainingSeconds',greatest(0,case when paid then monthly_seconds-used else free_seconds-free_used end),
  'purchasedSeconds',seconds,'purchaseRevision',revision,
  'totalRemainingSeconds',greatest(0,case when paid then monthly_seconds-used else free_seconds-free_used end)+seconds,
  'periodStart',case when paid then period_start end,'periodEnd',case when paid then period_end end,'subscription',null,
  'sandbox',jsonb_build_object('subscriptionActive',paid,'purchasedSeconds',seconds,'productId',product_id,'expiresAt',period_end)
 ) from account cross join wallet;
$$;
create or replace function public.reserve_metered_usage(p_owner uuid,p_session uuid,p_lease uuid,p_rate integer,p_allow_packs boolean,
 p_environment text default 'PRODUCTION') returns integer
language plpgsql security invoker set search_path='' as $$
declare a public.billing_accounts; test public.sandbox_billing_accounts; c public.billing_settings; old public.metered_usage_leases; g record;
 is_paid boolean; unlimited boolean; included integer; wanted integer:=15*p_rate; amount integer; take integer; allocation_list jsonb:='[]';
begin
 if p_environment is null or p_environment not in ('PRODUCTION','SANDBOX') then raise exception 'invalid environment'; end if;
 if p_rate not in (1,3) then raise exception 'invalid usage rate'; end if;
 insert into public.billing_accounts(owner_id) values(p_owner) on conflict do nothing;
 select * into a from public.billing_accounts where owner_id=p_owner for update;
 select * into old from public.metered_usage_leases where id=p_lease;
 if found then
  if old.owner_id<>p_owner or old.session_id<>p_session or old.rate<>p_rate or old.environment<>p_environment then raise exception 'lease mismatch'; end if;
  return old.seconds;
 end if;
 select * into c from public.billing_settings where singleton;
 is_paid:=coalesce(a.paid and a.period_start<=now() and a.period_end>now(),false);
 unlimited:=p_environment='PRODUCTION' and private.has_unlimited_usage(p_owner);
 if p_environment='SANDBOX' then
  insert into public.sandbox_billing_accounts(owner_id) values(p_owner) on conflict do nothing;
  select * into test from public.sandbox_billing_accounts where owner_id=p_owner for update;
  a.period_start:=test.period_start; a.period_end:=test.period_end;
  a.used_seconds:=test.used_seconds; a.free_used_seconds:=test.free_used_seconds;
  is_paid:=coalesce(test.active and test.period_start<=now() and test.period_end>now(),false);
 end if;
 included:=case when unlimited then wanted when is_paid then greatest(0,c.monthly_seconds-a.used_seconds) else greatest(0,c.free_seconds-a.free_used_seconds) end;
 included:=least(wanted,included); amount:=included;
 if p_environment='SANDBOX' then
  update public.sandbox_billing_accounts set used_seconds=used_seconds+case when is_paid then included else 0 end,
    free_used_seconds=free_used_seconds+case when is_paid then 0 else included end where owner_id=p_owner;
 elsif not unlimited then
  update public.billing_accounts set used_seconds=used_seconds+case when is_paid then included else 0 end,
    free_used_seconds=free_used_seconds+case when is_paid then 0 else included end where owner_id=p_owner;
 end if;
 -- Insert first so allocation ledger references have a durable parent.
 insert into public.metered_usage_leases(id,owner_id,session_id,environment,rate,seconds,allowance_seconds,allowance_period,paid,billable)
 values(p_lease,p_owner,p_session,p_environment,p_rate,amount,included,a.period_start,is_paid,not unlimited);
 if p_allow_packs and amount<wanted then
  for g in select * from public.minute_pack_purchases where owner_id=p_owner and environment=p_environment and refunded_at is null and remaining_seconds>0
    order by purchased_at,id for update loop
   take:=least(wanted-amount,g.remaining_seconds);
   update public.minute_pack_purchases set remaining_seconds=remaining_seconds-take where id=g.id;
   insert into public.minute_credit_ledger(owner_id,purchase_id,lease_id,kind,seconds) values(p_owner,g.id,p_lease,'reserve',-take);
   allocation_list:=allocation_list||jsonb_build_array(jsonb_build_object('id',g.id,'seconds',take)); amount:=amount+take;
   exit when amount=wanted;
  end loop;
 end if;
 update public.metered_usage_leases set seconds=amount,allocations=allocation_list where id=p_lease;
 return amount;
end $$;

create or replace function public.settle_metered_usage(p_owner uuid,p_lease uuid,p_consumed integer,p_final boolean default true) returns void
language plpgsql security invoker set search_path='' as $$
declare l public.metered_usage_leases; item jsonb; charged integer; remaining integer; refund integer; restored integer;
begin
 perform 1 from public.billing_accounts where owner_id=p_owner for update;
 select * into l from public.metered_usage_leases where id=p_lease and owner_id=p_owner for update;
 if not found or l.settled_at is not null then return; end if;
 if p_consumed<0 or p_consumed>l.seconds then raise exception 'invalid settlement'; end if;
 charged:=greatest(l.checkpoint_seconds,p_consumed);
 if not p_final then
  update public.metered_usage_leases set checkpoint_seconds=charged where id=p_lease; return;
 end if;
 refund:=greatest(0,l.allowance_seconds-charged);
 if l.billable and refund>0 and l.environment='SANDBOX' then
  update public.sandbox_billing_accounts set used_seconds=greatest(0,used_seconds-case when l.paid and period_start is not distinct from l.allowance_period then refund else 0 end),
    free_used_seconds=greatest(0,free_used_seconds-case when l.paid then 0 else refund end) where owner_id=p_owner;
 elsif l.billable and refund>0 then
  update public.billing_accounts set used_seconds=greatest(0,used_seconds-case when l.paid and period_start is not distinct from l.allowance_period then refund else 0 end),
    free_used_seconds=greatest(0,free_used_seconds-case when l.paid then 0 else refund end) where owner_id=p_owner;
 end if;
 remaining:=greatest(0,charged-l.allowance_seconds);
 for item in select value from jsonb_array_elements(l.allocations) loop
  refund:=greatest(0,(item->>'seconds')::integer-remaining);
  remaining:=greatest(0,remaining-(item->>'seconds')::integer);
  -- A refund never resurrects minutes from a refunded purchase.
  update public.minute_pack_purchases set remaining_seconds=remaining_seconds+refund
    where id=(item->>'id')::bigint and refunded_at is null returning refund into restored;
  if found and restored>0 then
   insert into public.minute_credit_ledger(owner_id,purchase_id,lease_id,kind,seconds) values(p_owner,(item->>'id')::bigint,p_lease,'release',restored);
  elsif not found and refund>0 then
   -- The unused held balance was also refunded. Keep both movements visible in the audit trail.
   insert into public.minute_credit_ledger(owner_id,purchase_id,lease_id,kind,seconds) values
    (p_owner,(item->>'id')::bigint,p_lease,'release',refund),
    (p_owner,(item->>'id')::bigint,p_lease,'refund',-refund);
  end if;
 end loop;
 update public.metered_usage_leases set settled_at=now(),charged_seconds=charged,checkpoint_seconds=charged where id=p_lease;
end $$;

revoke all on function public.apply_sandbox_entitlement(uuid,boolean,text,text,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.sandbox_account_usage(uuid) from public,anon,authenticated;
grant execute on function public.apply_sandbox_entitlement(uuid,boolean,text,text,timestamptz,timestamptz,timestamptz) to service_role;
grant execute on function public.sandbox_account_usage(uuid) to service_role;
create or replace function public.account_usage(p_owner uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select public.account_allowance_usage(p_owner)||jsonb_build_object('purchasedSeconds',p.seconds,'purchaseRevision',(select coalesce(max(id),0) from public.minute_pack_purchases where owner_id=p_owner and environment='PRODUCTION'),'totalRemainingSeconds',
 case when (public.account_allowance_usage(p_owner)->>'unlimited')::boolean then null
 else (public.account_allowance_usage(p_owner)->>'remainingSeconds')::bigint+p.seconds end)
 from (select coalesce(sum(remaining_seconds),0) seconds from public.minute_pack_purchases where owner_id=p_owner and environment='PRODUCTION' and refunded_at is null) p;
$$;

notify pgrst,'reload schema';
commit;
