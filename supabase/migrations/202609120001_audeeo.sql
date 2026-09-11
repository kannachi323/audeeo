begin;
create table public.sessions (
 id uuid primary key, owner_id uuid not null references auth.users on delete cascade,
 started_at timestamptz not null default now(), source_language text not null check(source_language in ('en','zh')),
 target_language text not null check(target_language in ('en','zh')), unique(id,owner_id)
);
create table public.segments (
 id text primary key, session_id uuid not null, owner_id uuid not null references auth.users on delete cascade,
 sequence integer not null check(sequence>=0), revision integer not null check(revision>0),
 start_ms integer not null check(start_ms>=0), end_ms integer not null check(end_ms>=start_ms),
 source_language text not null check(source_language in ('en','zh')), target_language text not null check(target_language in ('en','zh')),
 source_text text not null check(length(source_text)<=8000), translated_text text not null default '' check(length(translated_text)<=16000),
 state text not null check(state in ('pending','complete','translation-error')),
 foreign key(session_id,owner_id) references public.sessions(id,owner_id) on delete cascade
);
create index on public.sessions(owner_id,started_at desc);
create index on public.segments(owner_id,session_id,sequence);
alter table public.sessions enable row level security;
alter table public.segments enable row level security;
create policy owner_sessions on public.sessions for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy owner_segments on public.segments for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
-- Avoid late offline pending writes replacing already translated text.
create function public.guard_segment_revision() returns trigger language plpgsql as $$
begin
 if new.owner_id <> old.owner_id or new.session_id <> old.session_id then raise exception 'immutable owner'; end if;
 if new.revision < old.revision or (new.revision=old.revision and old.state in ('complete','translation-error') and new.state='pending') then return old; end if;
 return new;
end $$;
create trigger segment_revision before update on public.segments for each row execute function public.guard_segment_revision();

-- Private tables are never writable/readable with an end-user JWT.
create table public.commercial_config (
 singleton boolean primary key default true check(singleton), free_seconds integer not null default 0 check(free_seconds>=0),
 monthly_seconds integer not null default 0 check(monthly_seconds>=0), max_session_seconds integer not null default 1800 check(max_session_seconds between 15 and 14400),
 entitlement_id text not null default 'audeeo_monthly', product_id text, speech_enabled boolean not null default false,
 monthly_price_minor integer, currency text
);
insert into public.commercial_config(singleton) values(true);
create table public.allowances (
 owner_id uuid primary key references auth.users on delete cascade,
 period_start timestamptz, period_end timestamptz, entitlement_checked_at timestamptz,
 paid boolean not null default false, used_seconds integer not null default 0 check(used_seconds>=0),
 free_used_seconds integer not null default 0 check(free_used_seconds>=0)
);
create table public.usage_ledger (
 owner_id uuid not null references auth.users on delete cascade, session_id uuid not null,
 reservation integer not null, seconds integer not null check(seconds>0), created_at timestamptz not null default now(),
 primary key(owner_id,session_id,reservation)
);
create table public.billing_events (id text primary key, received_at timestamptz not null default now());
alter table public.commercial_config enable row level security;
alter table public.allowances enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.billing_events enable row level security;
revoke all on public.commercial_config,public.allowances,public.usage_ledger,public.billing_events from anon,authenticated;

create function public.reserve_usage(p_owner uuid,p_session uuid,p_reservation integer,p_seconds integer)
returns integer language plpgsql security definer set search_path=public as $$
declare a allowances; c commercial_config; remaining integer; charge integer;
begin
 if p_seconds not between 1 and 15 or p_reservation<0 then raise exception 'invalid reservation'; end if;
 insert into allowances(owner_id) values(p_owner) on conflict do nothing;
 select * into a from allowances where owner_id=p_owner for update;
 select seconds into charge from usage_ledger where owner_id=p_owner and session_id=p_session and reservation=p_reservation;
 if found then return charge; end if;
 select * into c from commercial_config where singleton;
 if a.paid and a.period_start<=now() and a.period_end>now() then remaining=c.monthly_seconds-a.used_seconds;
 else remaining=c.free_seconds-a.free_used_seconds; end if;
 charge=least(p_seconds,greatest(0,remaining));
 if charge=0 then return 0; end if;
 if a.paid and a.period_start<=now() and a.period_end>now() then
  update allowances set used_seconds=used_seconds+charge where owner_id=p_owner;
 else update allowances set free_used_seconds=free_used_seconds+charge where owner_id=p_owner; end if;
 insert into usage_ledger(owner_id,session_id,reservation,seconds) values(p_owner,p_session,p_reservation,charge);
 return charge;
end $$;

create function public.apply_entitlement(p_owner uuid,p_start timestamptz,p_end timestamptz,p_checked timestamptz,p_paid boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 insert into allowances(owner_id) values(p_owner) on conflict do nothing;
 perform 1 from allowances where owner_id=p_owner for update;
 update allowances set used_seconds=case when p_start is distinct from period_start and p_start>coalesce(period_start,'epoch') then 0 else used_seconds end,
  paid=p_paid,period_start=greatest(period_start,p_start),period_end=coalesce(p_end,period_end),entitlement_checked_at=p_checked
 where owner_id=p_owner and (entitlement_checked_at is null or entitlement_checked_at<p_checked);
end $$;
revoke all on function public.reserve_usage(uuid,uuid,integer,integer),public.apply_entitlement(uuid,timestamptz,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.reserve_usage(uuid,uuid,integer,integer),public.apply_entitlement(uuid,timestamptz,timestamptz,timestamptz,boolean) to service_role;

-- Keep a text-free tombstone so an old device cannot recreate deleted history.
alter table public.sessions add column deleted_at timestamptz;
create function public.reject_deleted_history() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform 1 from sessions where id=new.session_id for update;
 if exists(select 1 from sessions where id=new.session_id and deleted_at is not null) then raise exception 'session deleted'; end if;
 return new;
end $$;
create trigger reject_deleted before insert or update on public.segments for each row execute function public.reject_deleted_history();
create function public.protect_history_tombstone() returns trigger language plpgsql as $$
begin
 if old.deleted_at is not null then new.deleted_at=old.deleted_at; end if;
 return new;
end $$;
create trigger protect_tombstone before update on public.sessions for each row execute function public.protect_history_tombstone();
create function public.delete_history_session(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 update sessions set deleted_at=now() where id=p_id and owner_id=auth.uid();
 delete from segments where session_id=p_id and owner_id=auth.uid();
end $$;
revoke all on function public.delete_history_session(uuid) from public,anon;
grant execute on function public.delete_history_session(uuid) to authenticated;
-- Deletion must use the tombstone RPC. End users cannot remove or rewrite session rows.
drop policy owner_sessions on public.sessions;
create policy read_sessions on public.sessions for select to authenticated using(owner_id=auth.uid());
create policy insert_sessions on public.sessions for insert to authenticated with check(owner_id=auth.uid() and deleted_at is null);

commit;
