begin;

-- This account now follows normal purchased/subscription metering. Keep the
-- other existing development account's exemption and all financial records.
create or replace function private.has_unlimited_usage(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = p_owner and lower(email) = 'mtccool668@gmail.com'
  );
$$;

revoke all on function private.has_unlimited_usage(uuid) from public, anon, authenticated;
grant execute on function private.has_unlimited_usage(uuid) to service_role;

commit;
