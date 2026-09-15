begin;

create table public.session_summaries (
  session_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  language text not null check (char_length(language) between 2 and 32),
  content jsonb not null check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 65536),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  model text not null check (char_length(model) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_summaries_owned_session_fkey
    foreign key (session_id, owner_id)
    references public.sessions (id, owner_id)
    on delete cascade
);

create index session_summaries_owner_updated_idx
  on public.session_summaries (owner_id, updated_at desc);

alter table public.session_summaries enable row level security;

create policy "Users read their session summaries"
  on public.session_summaries for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users delete their session summaries"
  on public.session_summaries for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on table public.session_summaries from anon, authenticated;
grant select, delete on table public.session_summaries to authenticated;
grant select, insert, update, delete on table public.session_summaries to service_role;

create or replace function public.invalidate_session_summary()
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
    delete from public.session_summaries
      where session_id = old.session_id and owner_id = old.owner_id;
    return old;
  end if;
  delete from public.session_summaries
    where session_id = new.session_id and owner_id = new.owner_id;
  return new;
end;
$$;

revoke all on function public.invalidate_session_summary() from public, anon, authenticated;

create trigger invalidate_summary_when_segments_change
after insert or update or delete on public.segments
for each row execute function public.invalidate_session_summary();

commit;
