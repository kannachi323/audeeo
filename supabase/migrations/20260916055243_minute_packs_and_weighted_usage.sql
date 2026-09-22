begin;
set local lock_timeout = '5s';
update public.billing_settings set monthly_seconds=36000;
create table public.minute_pack_products (
 product_id text primary key, seconds integer not null check(seconds>0), enabled boolean not null default false
);
insert into public.minute_pack_products(product_id,seconds) values
 ('audeeo_minutes_60',3600),('audeeo_minutes_180',10800),('audeeo_minutes_600',36000),
 ('audeeo_minutes_60_web',3600),('audeeo_minutes_180_web',10800),('audeeo_minutes_600_web',36000);
create table public.minute_pack_purchases (
 id bigint generated always as identity primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 store text not null, environment text not null check(environment in ('PRODUCTION','SANDBOX')),
 transaction_id text not null, product_id text not null references public.minute_pack_products,
 granted_seconds integer not null check(granted_seconds>0), remaining_seconds integer not null check(remaining_seconds>=0),
 purchased_at timestamptz not null, refunded_at timestamptz, refund_review boolean not null default false,
 unique(store,environment,transaction_id), check(remaining_seconds<=granted_seconds)
);
create index minute_pack_owner_balance on public.minute_pack_purchases(owner_id,environment,purchased_at,id)
 where refunded_at is null and remaining_seconds>0;
create table public.metered_usage_leases (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade, session_id uuid not null,
 environment text not null check(environment in ('PRODUCTION','SANDBOX')), rate integer not null check(rate in (1,3)),
 seconds integer not null check(seconds between 0 and 45), checkpoint_seconds integer not null default 0,
 allowance_seconds integer not null default 0, allowance_period timestamptz, paid boolean not null,
 billable boolean not null, allocations jsonb not null default '[]',
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '45 seconds',
 settled_at timestamptz, charged_seconds integer,
 check(checkpoint_seconds between 0 and seconds)
);
create index metered_usage_owner on public.metered_usage_leases(owner_id);
create index metered_usage_expiry on public.metered_usage_leases(expires_at) where settled_at is null;
create table public.minute_credit_ledger (
 id bigint generated always as identity primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 purchase_id bigint not null references public.minute_pack_purchases(id), lease_id uuid references public.metered_usage_leases(id),
 kind text not null check(kind in ('purchase','reserve','release','refund')), seconds integer not null,
 created_at timestamptz not null default now()
);
create index minute_credit_ledger_owner on public.minute_credit_ledger(owner_id,created_at);
create index minute_credit_ledger_purchase on public.minute_credit_ledger(purchase_id);
create index minute_credit_ledger_lease on public.minute_credit_ledger(lease_id) where lease_id is not null;
-- No financial row is linked to expiring caption history.
create function public.apply_minute_purchase(p_owner uuid,p_store text,p_environment text,p_transaction text,
 p_product text,p_purchased_at timestamptz,p_refunded boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
declare pack public.minute_pack_products; purchase public.minute_pack_purchases; amount integer;
begin
 if length(p_transaction) not between 1 and 512 or length(p_store) not between 1 and 64 then raise exception 'invalid purchase'; end if;
 select * into pack from public.minute_pack_products where product_id=p_product;
 if not found then raise exception 'unknown pack'; end if;
 insert into public.billing_accounts(owner_id) values(p_owner) on conflict do nothing;
 perform 1 from public.billing_accounts where owner_id=p_owner for update;
 -- A refund arriving first creates a tombstone. Delayed purchase events cannot regrant it.
 insert into public.minute_pack_purchases(owner_id,store,environment,transaction_id,product_id,granted_seconds,remaining_seconds,purchased_at,refunded_at)
 values(p_owner,p_store,p_environment,p_transaction,p_product,pack.seconds,case when p_refunded then 0 else pack.seconds end,p_purchased_at,
 case when p_refunded then now() end) on conflict(store,environment,transaction_id) do nothing returning * into purchase;
 if found then
  insert into public.minute_credit_ledger(owner_id,purchase_id,kind,seconds) values(p_owner,purchase.id,'purchase',case when p_refunded then 0 else pack.seconds end);
  return;
 end if;
 select * into purchase from public.minute_pack_purchases where store=p_store and environment=p_environment and transaction_id=p_transaction for update;
 if purchase.owner_id<>p_owner or purchase.product_id<>p_product then raise exception 'purchase ownership mismatch'; end if;
 if p_refunded and purchase.refunded_at is null then
  amount:=purchase.remaining_seconds;
  update public.minute_pack_purchases set refunded_at=now(),remaining_seconds=0,
   refund_review=(select count(*)>=1 from public.minute_pack_purchases where owner_id=p_owner and refunded_at is not null)
   where id=purchase.id;
  insert into public.minute_credit_ledger(owner_id,purchase_id,kind,seconds) values(p_owner,purchase.id,'refund',-amount);
 end if;
end $$;

create function public.reserve_metered_usage(p_owner uuid,p_session uuid,p_lease uuid,p_rate integer,p_allow_packs boolean,
 p_environment text default 'PRODUCTION') returns integer
language plpgsql security invoker set search_path='' as $$
declare a public.billing_accounts; c public.billing_settings; old public.metered_usage_leases; g record;
 is_paid boolean; unlimited boolean; included integer; wanted integer:=15*p_rate; amount integer; take integer; allocation_list jsonb:='[]';
begin
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
 unlimited:=private.has_unlimited_usage(p_owner);
 included:=case when unlimited then wanted when is_paid then greatest(0,c.monthly_seconds-a.used_seconds) else greatest(0,c.free_seconds-a.free_used_seconds) end;
 included:=least(wanted,included); amount:=included;
 if not unlimited then
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

create function public.settle_metered_usage(p_owner uuid,p_lease uuid,p_consumed integer,p_final boolean default true) returns void
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
 if l.billable and refund>0 then
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
  end if;
 end loop;
 update public.metered_usage_leases set settled_at=now(),charged_seconds=charged,checkpoint_seconds=charged where id=p_lease;
end $$;

create function public.reconcile_usage_leases() returns integer language plpgsql security invoker set search_path='' as $$
declare l record; count integer:=0;
begin
 for l in select id,owner_id,checkpoint_seconds from public.metered_usage_leases where settled_at is null and expires_at<now() order by expires_at limit 1000 loop
  perform public.settle_metered_usage(l.owner_id,l.id,l.checkpoint_seconds,true); count:=count+1;
 end loop;
 return count;
end $$;

-- Preserve the existing API contract while adding the separate wallet balance.
alter function public.account_usage(uuid) rename to account_allowance_usage;
create function public.account_usage(p_owner uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select public.account_allowance_usage(p_owner)||jsonb_build_object('purchasedSeconds',p.seconds,'purchaseRevision',(select coalesce(max(id),0) from public.minute_pack_purchases where owner_id=p_owner),'totalRemainingSeconds',
 case when (public.account_allowance_usage(p_owner)->>'unlimited')::boolean then null
 else (public.account_allowance_usage(p_owner)->>'remainingSeconds')::bigint+p.seconds end)
 from (select coalesce(sum(remaining_seconds),0) seconds from public.minute_pack_purchases where owner_id=p_owner and environment='PRODUCTION' and refunded_at is null) p;
$$;

do $$ declare t text; f regprocedure; begin
 foreach t in array array['minute_pack_products','minute_pack_purchases','metered_usage_leases','minute_credit_ledger'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update on public.%I to service_role',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in
 ('apply_minute_purchase','reserve_metered_usage','settle_metered_usage','reconcile_usage_leases','account_usage') loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
grant usage,select on sequence public.minute_pack_purchases_id_seq,public.minute_credit_ledger_id_seq to service_role;
-- Ledger entries are append-only even for the relay role.
revoke update on public.minute_credit_ledger from service_role;
notify pgrst,'reload schema';
commit;
