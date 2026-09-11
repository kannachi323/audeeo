-- Model capabilities belong in the relay catalog; history stores language codes
-- across model versions, including auto detection and regional Chinese hints.
begin;
set local lock_timeout = '5s';
alter table public.sessions
  drop constraint sessions_source_language_check,
  drop constraint sessions_target_language_check,
  add constraint sessions_source_language_check check (source_language = 'auto' or source_language ~ '^[a-z]{2,3}(-[a-z]{2})?$') not valid,
  add constraint sessions_target_language_check check (target_language = 'auto' or target_language ~ '^[a-z]{2,3}(-[a-z]{2})?$') not valid;
alter table public.segments
  drop constraint segments_source_language_check,
  drop constraint segments_target_language_check,
  add constraint segments_source_language_check check (source_language = 'auto' or source_language ~ '^[a-z]{2,3}(-[a-z]{2})?$') not valid,
  add constraint segments_target_language_check check (target_language = 'auto' or target_language ~ '^[a-z]{2,3}(-[a-z]{2})?$') not valid;
commit;
-- Validate outside the exclusive-lock transaction so normal writes can proceed.
alter table public.sessions validate constraint sessions_source_language_check;
alter table public.sessions validate constraint sessions_target_language_check;
alter table public.segments validate constraint segments_source_language_check;
alter table public.segments validate constraint segments_target_language_check;
