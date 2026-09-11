-- Supabase may provision this DDL event trigger. It is not a client RPC.
-- Keep the automatic RLS behavior while revoking API-role execution.
do $$
begin
 if to_regprocedure('public.rls_auto_enable()') is not null then
  revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
 end if;
end $$;
