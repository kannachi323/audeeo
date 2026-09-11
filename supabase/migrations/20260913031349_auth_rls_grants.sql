begin;

-- Grant only the operations supported by the history API, independently of
-- the project's default privileges. RLS remains the owner boundary.
grant usage on schema public to authenticated, service_role;
revoke all on public.sessions, public.segments from anon, authenticated;
grant select, insert on public.sessions to authenticated;
grant select, insert, update, delete on public.segments to authenticated;
grant select, insert, update, delete on public.sessions, public.segments,
  public.commercial_config, public.allowances, public.usage_ledger,
  public.billing_events to service_role;

alter policy read_sessions on public.sessions using (owner_id = (select auth.uid()));
alter policy insert_sessions on public.sessions
  with check (owner_id = (select auth.uid()) and deleted_at is null);
alter policy owner_segments on public.segments
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- The relay already operates as service_role, so these functions do not
-- need the database owner's privileges.
alter function public.reserve_usage(uuid, uuid, integer, integer) security invoker;
alter function public.apply_entitlement(uuid, timestamptz, timestamptz, timestamptz, boolean) security invoker;
alter function public.guard_segment_revision() set search_path = '';
alter function public.protect_history_tombstone() set search_path = '';

-- Keep privileged trigger and tombstone implementation out of the Data API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
alter function public.reject_deleted_history() set schema private;
alter function private.reject_deleted_history() set search_path = '';
create or replace function private.reject_deleted_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is not null and new.owner_id <> auth.uid() then
  raise exception 'history owner mismatch';
 end if;
 perform 1 from public.sessions where id = new.session_id and owner_id = new.owner_id for update;
 if exists(select 1 from public.sessions where id = new.session_id and owner_id = new.owner_id and deleted_at is not null) then
  raise exception 'session deleted';
 end if;
 return new;
end $$;
revoke all on function private.reject_deleted_history() from public, anon, authenticated;
revoke all on function public.guard_segment_revision(), public.protect_history_tombstone() from public, anon, authenticated;

alter function public.delete_history_session(uuid) set schema private;
create or replace function private.delete_history_session(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid();
begin
 if owner is null then raise exception 'sign-in required'; end if;
 update public.sessions set deleted_at = now() where id = p_id and owner_id = owner;
 delete from public.segments where session_id = p_id and owner_id = owner;
end $$;
revoke all on function private.delete_history_session(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.delete_history_session(uuid) to authenticated;
create function public.delete_history_session(p_id uuid) returns void
language sql security invoker set search_path = '' as $$
 select private.delete_history_session(p_id);
$$;
revoke all on function public.delete_history_session(uuid) from public, anon;
grant execute on function public.delete_history_session(uuid) to authenticated;

commit;
