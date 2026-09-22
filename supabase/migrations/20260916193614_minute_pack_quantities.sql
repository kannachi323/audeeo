begin;
set local lock_timeout='5s';
alter table public.minute_pack_purchases add column quantity integer not null default 1 check(quantity between 1 and 10);

create or replace function public.apply_minute_purchase(p_owner uuid,p_store text,p_environment text,p_transaction text,
 p_product text,p_purchased_at timestamptz,p_refunded boolean,p_quantity integer) returns void
language plpgsql security invoker set search_path='' as $$
declare pack public.minute_pack_products; purchase public.minute_pack_purchases; amount integer; units integer:=coalesce(p_quantity,1);
begin
 if units not between 1 and 10 then raise exception 'invalid quantity'; end if;
 if length(p_transaction) not between 1 and 512 or length(p_store) not between 1 and 64 then raise exception 'invalid purchase'; end if;
 select * into pack from public.minute_pack_products where product_id=p_product;
 if not found then raise exception 'unknown pack'; end if;
 insert into public.billing_accounts(owner_id) values(p_owner) on conflict do nothing;
 perform 1 from public.billing_accounts where owner_id=p_owner for update;
 -- A refund arriving first creates a tombstone. Delayed purchase events cannot regrant it.
 insert into public.minute_pack_purchases(owner_id,store,environment,transaction_id,product_id,granted_seconds,remaining_seconds,purchased_at,refunded_at,refund_review,quantity)
 values(p_owner,p_store,p_environment,p_transaction,p_product,pack.seconds*units,case when p_refunded then 0 else pack.seconds*units end,p_purchased_at,
 case when p_refunded then now() end,p_refunded and exists(select 1 from public.minute_pack_purchases where owner_id=p_owner and refunded_at is not null),units) on conflict(store,environment,transaction_id) do nothing returning * into purchase;
 if found then
  insert into public.minute_credit_ledger(owner_id,purchase_id,kind,seconds) values(p_owner,purchase.id,'purchase',pack.seconds*units);
  if p_refunded then insert into public.minute_credit_ledger(owner_id,purchase_id,kind,seconds) values(p_owner,purchase.id,'refund',-pack.seconds*units); end if;
  return;
 end if;
 select * into purchase from public.minute_pack_purchases where store=p_store and environment=p_environment and transaction_id=p_transaction for update;
 if purchase.owner_id<>p_owner or purchase.product_id<>p_product then raise exception 'purchase ownership mismatch'; end if;
 -- Older webhooks/v1 records can omit quantity. A later verified store record
 -- adds only the missing units, preserving consumed minutes and refund tombstones.
 if units>purchase.quantity then
  amount:=pack.seconds*(units-purchase.quantity);
  update public.minute_pack_purchases set quantity=units,granted_seconds=granted_seconds+amount,
   remaining_seconds=remaining_seconds+case when refunded_at is null then amount else 0 end
   where id=purchase.id returning * into purchase;
  insert into public.minute_credit_ledger(owner_id,purchase_id,kind,seconds) values(p_owner,purchase.id,'purchase',amount);
  if purchase.refunded_at is not null then
   insert into public.minute_credit_ledger(owner_id,purchase_id,kind,seconds) values(p_owner,purchase.id,'refund',-amount);
  end if;
 end if;
 if p_refunded and purchase.refunded_at is null then
  amount:=purchase.remaining_seconds;
  update public.minute_pack_purchases set refunded_at=now(),remaining_seconds=0,
   refund_review=(select count(*)>=1 from public.minute_pack_purchases where owner_id=p_owner and refunded_at is not null)
   where id=purchase.id;
  insert into public.minute_credit_ledger(owner_id,purchase_id,kind,seconds) values(p_owner,purchase.id,'refund',-amount);
 end if;
end $$;

-- Preserve older clients during rollout without ambiguous default arguments.
create or replace function public.apply_minute_purchase(p_owner uuid,p_store text,p_environment text,p_transaction text,
 p_product text,p_purchased_at timestamptz,p_refunded boolean default false) returns void
language sql security invoker set search_path='' as $$
 select public.apply_minute_purchase(p_owner,p_store,p_environment,p_transaction,p_product,p_purchased_at,p_refunded,null);
$$;
revoke all on function public.apply_minute_purchase(uuid,text,text,text,text,timestamptz,boolean,integer) from public,anon,authenticated;
grant execute on function public.apply_minute_purchase(uuid,text,text,text,text,timestamptz,boolean,integer) to service_role;
commit;
