begin;
set local lock_timeout='5s';
create or replace function public.apply_minute_purchase(p_owner uuid,p_store text,p_environment text,p_transaction text,
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
 insert into public.minute_pack_purchases(owner_id,store,environment,transaction_id,product_id,granted_seconds,remaining_seconds,purchased_at,refunded_at,refund_review)
 values(p_owner,p_store,p_environment,p_transaction,p_product,pack.seconds,case when p_refunded then 0 else pack.seconds end,p_purchased_at,
 case when p_refunded then now() end,p_refunded and exists(select 1 from public.minute_pack_purchases where owner_id=p_owner and refunded_at is not null)) on conflict(store,environment,transaction_id) do nothing returning * into purchase;
 if found then
  insert into public.minute_credit_ledger(owner_id,purchase_id,kind,seconds) values(p_owner,purchase.id,'purchase',pack.seconds);
  if p_refunded then insert into public.minute_credit_ledger(owner_id,purchase_id,kind,seconds) values(p_owner,purchase.id,'refund',-pack.seconds); end if;
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
  elsif not found and refund>0 then
   -- The unused held balance was also refunded. Keep both movements visible in the audit trail.
   insert into public.minute_credit_ledger(owner_id,purchase_id,lease_id,kind,seconds) values
    (p_owner,(item->>'id')::bigint,p_lease,'release',refund),
    (p_owner,(item->>'id')::bigint,p_lease,'refund',-refund);
  end if;
 end loop;
 update public.metered_usage_leases set settled_at=now(),charged_seconds=charged,checkpoint_seconds=charged where id=p_lease;
end $$;

commit;
