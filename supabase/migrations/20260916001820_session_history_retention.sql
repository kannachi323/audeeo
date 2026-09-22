begin;
set local lock_timeout = '5s';

create table public.session_history_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  save_sessions boolean not null default true,
  generation bigint not null default 1 check (generation > 0),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz
);
alter table public.session_history_settings enable row level security;
revoke all on public.session_history_settings from public,anon,authenticated;
grant select on public.session_history_settings to authenticated;
grant all on public.session_history_settings to service_role;
create policy session_history_settings_select_owner on public.session_history_settings
 for select to authenticated using (owner_id = (select auth.uid()));

alter table public.caption_sessions
 add column created_at timestamptz not null default now(),
 add column completed_at timestamptz not null default now(),
 add column expires_at timestamptz,
 add column history_generation bigint not null default 1,
 add column deletion_reason text check (deletion_reason in ('manual','retention','saving-disabled')),
 add column lifecycle_state text generated always as
   (case when deleted_at is null then 'saved' when deletion_reason = 'retention' then 'expired' else 'deleted' end) stored;
update public.caption_sessions set
 created_at=least(updated_at,now()),
 completed_at=least(started_at + duration_ms * interval '1 millisecond',now()),
 expires_at=started_at + interval '720 hours',
 deletion_reason=case when deleted_at is not null then 'manual' end;
alter table public.caption_sessions alter column expires_at set not null;
create index caption_sessions_expiry_idx on public.caption_sessions(expires_at,id) where deleted_at is null;

create function private.enforce_caption_retention() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then new.started_at=old.started_at; end if;
 new.expires_at=new.started_at + interval '720 hours';
 if new.deleted_at is null and new.expires_at <= statement_timestamp() then
   new.deleted_at=statement_timestamp(); new.deletion_reason='retention';
 end if;
 if new.deleted_at is not null then
   new.deletion_reason=coalesce(new.deletion_reason,'manual');
   new.transcript='[]'::jsonb; new.summary=null; new.preview=''; new.segment_count=0; new.duration_ms=0;
 end if;
 return new;
end $$;
revoke all on function private.enforce_caption_retention() from public,anon,authenticated;
create trigger enforce_caption_retention before insert or update on public.caption_sessions
 for each row execute function private.enforce_caption_retention();
alter policy caption_sessions_select_owner on public.caption_sessions
 using (owner_id=(select auth.uid()) and deleted_at is null and expires_at > now());

create function private.session_history_settings(p_enabled boolean default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); setting public.session_history_settings;
begin
 if owner is null then raise exception 'sign-in required'; end if;
 insert into public.session_history_settings(owner_id) values(owner) on conflict do nothing;
 select * into setting from public.session_history_settings where owner_id=owner for update;
 if p_enabled is not null and p_enabled is distinct from setting.save_sessions then
   update public.session_history_settings set save_sessions=p_enabled,generation=generation+1,
     updated_at=clock_timestamp(),disabled_at=case when not p_enabled then clock_timestamp() else disabled_at end
     where owner_id=owner returning * into setting;
 end if;
 if p_enabled=false then
   update public.caption_sessions set deleted_at=coalesce(deleted_at,clock_timestamp()),deletion_reason='saving-disabled',
     updated_at=clock_timestamp(),transcript_version=transcript_version+1
     where owner_id=owner and deleted_at is null;
 end if;
 return jsonb_build_object('saveSessions',setting.save_sessions,'generation',setting.generation,'retentionDays',30);
end $$;
revoke all on function private.session_history_settings(boolean) from public,anon,authenticated;
grant execute on function private.session_history_settings(boolean) to authenticated;
create function public.get_session_history_settings() returns jsonb
language sql security invoker set search_path='' as $$ select private.session_history_settings(); $$;
create function public.set_session_history_settings(p_enabled boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if p_enabled is null then raise exception 'choose whether to save sessions'; end if;
 return private.session_history_settings(p_enabled);
end $$;
revoke all on function public.get_session_history_settings() from public,anon,authenticated;
revoke all on function public.set_session_history_settings(boolean) from public,anon,authenticated;
grant execute on function public.get_session_history_settings(),public.set_session_history_settings(boolean) to authenticated;

-- Keep the tested merge implementation private; all uploads must cross the
-- preference/generation gate while holding the same lock as the off toggle.
alter function private.sync_caption_session(uuid,jsonb,timestamptz) rename to merge_caption_document;
revoke all on function private.merge_caption_document(uuid,jsonb,timestamptz) from public,anon,authenticated;
drop function public.sync_caption_session(uuid,jsonb,timestamptz);
create function private.sync_caption_session(p_id uuid,p_segments jsonb,p_started_at timestamptz default null,p_history_generation bigint default null)
returns void language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); setting public.session_history_settings; started timestamptz;
begin
 if owner is null then raise exception 'sign-in required'; end if;
 insert into public.session_history_settings(owner_id) values(owner) on conflict do nothing;
 select * into setting from public.session_history_settings where owner_id=owner for update;
 -- Acknowledge discarded stale uploads so offline outboxes erase them too.
 if not setting.save_sessions or coalesce(p_history_generation,1) <> setting.generation then return; end if;
 started=least(coalesce(p_started_at,clock_timestamp()),clock_timestamp());
 if started + interval '720 hours' <= clock_timestamp() then return; end if;
 perform private.merge_caption_document(p_id,p_segments,started);
 update public.caption_sessions set history_generation=setting.generation
   where id=p_id and owner_id=owner and deleted_at is null;
end $$;
revoke all on function private.sync_caption_session(uuid,jsonb,timestamptz,bigint) from public,anon,authenticated;
grant execute on function private.sync_caption_session(uuid,jsonb,timestamptz,bigint) to authenticated;
create function public.sync_caption_session(p_id uuid,p_segments jsonb,p_started_at timestamptz default null,p_history_generation bigint default null)
returns void language sql security invoker set search_path='' as $$
 select private.sync_caption_session(p_id,p_segments,p_started_at,p_history_generation);
$$;
revoke all on function public.sync_caption_session(uuid,jsonb,timestamptz,bigint) from public,anon,authenticated;
grant execute on function public.sync_caption_session(uuid,jsonb,timestamptz,bigint) to authenticated;

create function private.expire_caption_sessions() returns bigint
language plpgsql security invoker set search_path='' as $$
declare affected integer; total bigint:=0;
begin
 loop
   with due as (
     select id from public.caption_sessions where deleted_at is null and expires_at<=now()
     order by expires_at,id limit 1000 for update skip locked
   )
   update public.caption_sessions s set deleted_at=now(),deletion_reason='retention',updated_at=now(),
     transcript_version=transcript_version+1 from due where s.id=due.id;
   get diagnostics affected=row_count;
   total=total+affected;
   exit when affected=0;
 end loop;
 return total;
end $$;
revoke all on function private.expire_caption_sessions() from public,anon,authenticated,service_role;

-- Supabase provides pg_cron. Plain PostgreSQL test clusters exercise the same
-- cleanup function directly and do not have the scheduler extension installed.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
   create extension if not exists pg_cron;
   perform cron.schedule('audeeo-expire-sessions','0 0 * * *','select private.expire_caption_sessions();');
 else raise notice 'pg_cron unavailable: install it before deploying outside a test cluster';
 end if;
end $$;
comment on column public.caption_sessions.expires_at is 'Fixed 30-day expiry from session start; retries, summaries and edits never extend it. Reads stop at expiry, content is purged at midnight.';
comment on column public.caption_sessions.lifecycle_state is 'Saved completed document, deleted tombstone, or expired tombstone. Tombstones retain no transcript/summary and prevent replay.';
comment on table public.session_history_settings is 'Owner-controlled history preference and upload generation. Turning off deletes content atomically and invalidates offline uploads.';
create or replace function public.save_caption_summary(p_owner uuid, p_id uuid, p_version bigint, p_summary jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_session public.caption_sessions; result jsonb;
begin
  select * into current_session from public.caption_sessions where id=p_id and owner_id=p_owner for update;
  if not found or current_session.deleted_at is not null or current_session.expires_at <= now() then raise exception 'session unavailable'; end if;
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

commit;
