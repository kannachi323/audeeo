#!/usr/bin/env python3
"""Run the real migration against an isolated, disposable local PostgreSQL cluster."""
import concurrent.futures, json, os, pathlib, shutil, subprocess, sys, tempfile
root=pathlib.Path(__file__).resolve().parents[1]
work=pathlib.Path(tempfile.mkdtemp(prefix='audeeo-pg-'))
windows=sys.platform == 'win32'
env={**os.environ,'PGHOST':'127.0.0.1' if windows else str(work),'PGPORT':'55439','PGDATABASE':'postgres'}
def run(*args,**kw):return subprocess.run(args,check=True,text=True,encoding='utf-8',capture_output=True,env=env,**kw)
def sql(text):
 try:return run('psql','-X','-v','ON_ERROR_STOP=1','-At','-c',text).stdout.strip()
 except subprocess.CalledProcessError as error:
  error.add_note(error.stderr)
  raise
try:
 run('initdb','-D',str(work/'data'),'-A','trust','--no-locale')
 server_options = "-p 55439 -c listen_addresses=127.0.0.1" if windows else f"-k {work} -p 55439 -c listen_addresses=''"
 # On Windows, a detached postgres child inherits captured pipe handles and
 # prevents subprocess.run from observing EOF even after pg_ctl exits.
 subprocess.run(('pg_ctl','-D',str(work/'data'),'-l',str(work/'postgres.log'),'-o',server_options,'start'),
                check=True,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 sql("""create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public to authenticated,anon,service_role;
 grant execute on function auth.uid() to authenticated;
 """)
 # Seed the previous schema immediately before the consolidation migration,
 # then compare every retained value, including a subscription without counters.
 rename_tables = {
  'sessions':'caption_sessions', 'segments':'caption_segments',
  'session_summaries':'caption_summaries', 'commercial_config':'billing_settings',
  'usage_ledger':'usage_reservations', 'billing_events':'billing_webhook_events',
 }
 fixture_owner='99999999-9999-4999-8999-999999999999'
 fixture_orphan='88888888-8888-4888-8888-888888888888'
 fixture_session='77777777-7777-4777-8777-777777777777'
 def snapshot(query): return sql(f"select coalesce(jsonb_agg(to_jsonb(row)), '[]') from ({query}) row;")
 for migration in sorted((root/'supabase/migrations').glob('*.sql')):
  consolidating = migration.name.endswith('_clarify_table_names_and_merge_billing_accounts.sql')
  if consolidating:
   sql(f"""
    insert into auth.users values ('{fixture_owner}', 'migration@example.com'), ('{fixture_orphan}', 'orphan@example.com');
    insert into sessions(id,owner_id,source_language,target_language) values ('{fixture_session}','{fixture_owner}','en','zh');
    insert into segments values ('migration-segment','{fixture_session}','{fixture_owner}',0,3,0,1000,'en','zh','preserve me','translation','complete');
    insert into session_summaries(session_id,owner_id,language,content,source_hash,request_hash,model)
      values ('{fixture_session}','{fixture_owner}','en','{{"title":"Preserve summary"}}','{'c'*64}','{'d'*64}','test-model');
    insert into allowances values ('{fixture_owner}',now()-interval '1 day',now()+interval '29 days',now(),true,45,30);
    insert into billing_subscriptions(owner_id,revenuecat_customer_id,subscription_id,entitlement_id,product_id,store,active,period_start,period_end,checked_at)
      values ('{fixture_owner}','rc-migration','sub-migration','audeeo_pro','yearly','stripe',true,now()-interval '2 days',now()+interval '364 days',now()-interval '1 hour'),
        ('{fixture_orphan}','rc-orphan','sub-orphan','audeeo_pro','monthly',null,false,null,null,now());
    insert into usage_ledger(owner_id,session_id,reservation,seconds,billable) values ('{fixture_owner}','{fixture_session}',3,15,true);
    insert into billing_events(id) values ('migration-event');
   """)
   before = {old:snapshot(f'select * from public.{old}') for old in rename_tables}
   before_allowance = snapshot('select * from public.allowances order by owner_id')
   before_subscription = snapshot('select * from public.billing_subscriptions order by owner_id')
  run('psql','-X','-v','ON_ERROR_STOP=1','-f',str(migration))
  if consolidating:
   for old,new in rename_tables.items():
    if old == 'sessions': query = 'select id,owner_id,started_at,source_language,target_language,deleted_at from caption_sessions'
    elif old == 'segments': query = "select item || jsonb_build_object('owner_id',s.owner_id,'session_id',s.id) as item from caption_sessions s cross join lateral jsonb_array_elements(transcript) item"
    elif old == 'session_summaries': query = "select summary || jsonb_build_object('owner_id',owner_id) as item from caption_sessions where summary is not null"
    else: query = f'select * from public.{new}'
    if old in ('segments','session_summaries'):
     after = sql(f"select coalesce(jsonb_agg(item),'[]') from ({query}) expanded")
    else: after = snapshot(query)
    assert before[old] == after, f'{old} lost data'
   assert before_allowance == snapshot(f"select owner_id,period_start,period_end,entitlement_checked_at,paid,used_seconds,free_used_seconds from billing_accounts where owner_id='{fixture_owner}' order by owner_id")
   assert before_subscription == snapshot("select owner_id,revenuecat_customer_id,subscription_id,entitlement_id,product_id,store,subscription_active as active,subscription_period_start as period_start,subscription_period_end as period_end,subscription_checked_at as checked_at,subscription_created_at as created_at,subscription_updated_at as updated_at from billing_accounts where subscription_id is not null order by owner_id")
   assert sql(f"select paid::text||':'||used_seconds from billing_accounts where owner_id='{fixture_orphan}';") == 'false:0'
   assert sql("select count(*) from pg_tables where schemaname='public';") == '5'
   assert sql("select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity;") == '0'
   # Verify the migrated paid balance and retained provider snapshot through the API.
   assert sql(f"select account_usage('{fixture_owner}')->>'usedSeconds';") == '45'
   assert sql(f"select account_usage('{fixture_owner}')->'subscription'->>'id';") == 'sub-migration'
   sql(f"delete from auth.users where id in ('{fixture_owner}','{fixture_orphan}'); delete from billing_webhook_events where id='migration-event';")
 a='11111111-1111-4111-8111-111111111111';b='22222222-2222-4222-8222-222222222222';s='33333333-3333-4333-8333-333333333333'
 sql(f"insert into auth.users values('{a}','mtccool668@gmail.com'),('{b}','user@example.com'); update billing_settings set free_seconds=60,monthly_seconds=120;")
 def caption(id='seg', **overrides):
  return dict(id=id,sequence=0,revision=1,start_ms=0,end_ms=1000,source_language='zh',target_language='en',source_text='source text',translated_text='hello',state='complete',**{}) | overrides
 def upload(owner, session_id, items):
  payload=json.dumps(items).replace("'", "''")
  return sql(f"set role authenticated;set request.jwt.claim.sub='{owner}';select sync_caption_session('{session_id}','{payload}'::jsonb,'2026-09-01T12:00:00Z');")
 def denied(query):
  try:sql(query);raise AssertionError('unauthorized or invalid operation accepted')
  except subprocess.CalledProcessError:pass
 def summary(owner, session_id, version=None):
  if version is None: version=sql(f"select transcript_version from caption_sessions where id='{session_id}'")
  payload=json.dumps(dict(language='en',content={'title':'Summary'},source_hash='a'*64,request_hash='b'*64,model='test')).replace("'", "''")
  return sql(f"set role service_role;select save_caption_summary('{owner}','{session_id}',{version},'{payload}'::jsonb)")
 upload(a,s,[caption()])
 assert sql(f"select started_at = '2026-09-01T12:00:00Z'::timestamptz from caption_sessions where id='{s}'")=='t'
 assert sql(f"select segment_count||':'||duration_ms||':'||preview from caption_sessions where id='{s}'")=='1:1000:source text'
 for table in ['caption_sessions','billing_accounts','billing_settings','usage_reservations','billing_webhook_events']:
  denied(f"set role anon;select * from {table}")
  if table != 'caption_sessions': denied(f"set role authenticated;select * from {table}")
 assert sql(f"set role authenticated;set request.jwt.claim.sub='{b}';select count(*) from caption_sessions").splitlines()[-1]=='0'
 for query in [
  f"set role authenticated;set request.jwt.claim.sub='{a}';update caption_sessions set summary='{{}}' where id='{s}'",
  f"set role authenticated;set request.jwt.claim.sub='{a}';update caption_sessions set transcript='[]' where id='{s}'",
  f"set role authenticated;set request.jwt.claim.sub='{a}';delete from caption_sessions where id='{s}'",
  f"set role authenticated;select save_caption_summary('{a}','{s}',1,'{{}}')",
  f"set role authenticated;select account_usage('{a}')",
  f"set role authenticated;select reserve_usage('{a}','{s}',99,15)",
  f"set role anon;select sync_caption_session('{s}','[]')",
  f"set role authenticated;select apply_entitlement('{a}',now(),now()+interval '1 day',now(),true,'rc-a','sub-a','audeeo_pro','yearly','stripe')",
 ]: denied(query)
 try:upload(b,s,[caption(source_text='attack')]);raise AssertionError('cross-owner document upload accepted')
 except subprocess.CalledProcessError:pass
 # Invalid JSON cannot create a partial session; fields retain old constraints.
 bad_session='44444444-4444-4444-8444-444444444444'
 for bad in [caption(state=None), caption(source_text=None), caption(sequence=-1),caption(revision=0),caption(end_ms=-1),caption(source_language='not-a-language'),caption(source_text='x'*8001),{}]:
  try:upload(a,bad_session,[bad]);raise AssertionError('invalid caption accepted')
  except subprocess.CalledProcessError:pass
 assert sql(f"select count(*) from caption_sessions where id='{bad_session}'")=='0'
 # Idempotent retries and stale pending updates preserve the document and summary.
 summary(a,s)
 version=sql(f"select transcript_version from caption_sessions where id='{s}'")
 upload(a,s,[caption()]);upload(a,s,[caption(state='pending',translated_text='')])
 assert sql(f"select transcript_version||':'||summary_title from caption_sessions where id='{s}'")==version+':Summary'
 upload(a,s,[caption(translated_text='updated translation')])
 assert sql(f"select transcript_version||':'||summary_title from caption_sessions where id='{s}'")==version+':Summary'
 upload(a,s,[caption(revision=2,source_text='changed source')])
 assert sql(f"select summary is null from caption_sessions where id='{s}'")=='t'
 try:summary(a,s,version);raise AssertionError('stale summary accepted')
 except subprocess.CalledProcessError:pass
 summary(a,s)
 # Multiple uploads serialize on the single session row without losing captions.
 def append(i): return upload(a,s,[caption(id=f'part-{i}',sequence=i+1)])
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: list(pool.map(append,range(20)))
 assert sql(f"select segment_count||':'||jsonb_array_length(transcript) from caption_sessions where id='{s}'")=='21:21'
 assert sql(f"select transcript->0->>'source_text' from caption_sessions where id='{s}'")=='changed source'
 # A completed session containing hundreds of captions is accepted in one call.
 upload(a,bad_session,[caption(id=f'batch-{i}',sequence=i) for i in range(250)])
 assert sql(f"select segment_count from caption_sessions where id='{bad_session}'")=='250'
 sql(f"set role authenticated;set request.jwt.claim.sub='{a}';select delete_history_session('{bad_session}')")
 # Deleting an as-yet unsynced session also prevents late upload resurrection.
 unseen='55555555-5555-4555-8555-555555555555'
 sql(f"set role authenticated;set request.jwt.claim.sub='{a}';select delete_history_session('{unseen}')")
 upload(a,unseen,[caption()])
 assert sql(f"select jsonb_array_length(transcript) from caption_sessions where id='{unseen}'")=='0'
 # Simultaneous caption_sessions and duplicate reservations share one locked allowance.
 # Use the ordinary account here; the first account is intentionally unlimited.
 def reserve(i):return int(sql(f"set role service_role;select reserve_usage('{b}','{s}',{i},15);").splitlines()[-1])
 with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool: list(pool.map(reserve,range(20)))
 assert sql(f"select sum(seconds) from usage_reservations where owner_id='{b}';")=='60'
 assert reserve(0) in (0,15)
 assert sql(f"select sum(seconds) from usage_reservations where owner_id='{b}';")=='60'
 # Verified-email development accounts bypass limits, including case changes,
 # while retaining a non-billable audit trail.
 assert sql(f"set role service_role;select reserve_usage('{a}','{s}',500,15);").splitlines()[-1]=='15'
 assert sql(f"select billable::text from usage_reservations where owner_id='{a}' and reservation=500;")=='false'
 try:sql(f"set role service_role;select apply_entitlement('{b}',now(),now()+interval '1 day',now(),true,'rc-b',null,'audeeo_pro','yearly','stripe');");raise AssertionError('paid entitlement accepted without subscription id')
 except subprocess.CalledProcessError:pass
 sql(f"select apply_entitlement('{b}',now()-interval '1 day',now()+interval '29 days',now(),true,'rc-b','sub-b','audeeo_pro','yearly','stripe');")
 assert sql(f"select revenuecat_customer_id||':'||subscription_id||':'||product_id||':'||store||':'||subscription_active::text from billing_accounts where owner_id='{b}';")=='rc-b:sub-b:yearly:stripe:true'
 assert int(sql(f"select reserve_usage('{b}','{s}',100,15);"))==15
 assert sql(f"select (account_usage('{b}')->>'usedSeconds')||':'||(account_usage('{b}')->>'remainingSeconds');")=='15:105'
 # Restoration of same period preserves usage; stale events cannot revoke newer state.
 sql(f"select apply_entitlement('{b}',(select period_start from billing_accounts where owner_id='{b}'),(select period_end from billing_accounts where owner_id='{b}'),now()+interval '1 second',true,'rc-b','sub-b','audeeo_pro','yearly','stripe');select apply_entitlement('{b}',null,null,now()-interval '1 day',false,'rc-b',null,'audeeo_pro',null,null);")
 assert sql(f"select used_seconds||':'||paid::text from billing_accounts where owner_id='{b}';")=='15:true'
 sql(f"select apply_entitlement('{b}',now()-interval '31 days',now()-interval '1 day',now()+interval '2 seconds',false,'rc-b','sub-b','audeeo_pro','yearly','stripe');")
 assert sql(f"select subscription_active::text from billing_accounts where owner_id='{b}';")=='false'
 assert sql(f"select reserve_usage('{b}','{s}',101,15);")=='0'
 # Tombstones clear the entire document, preserve metering, and reject replay.
 sql(f"set role authenticated;set request.jwt.claim.sub='{b}';select delete_history_session('{s}');")
 assert sql(f"select deleted_at is null from caption_sessions where id='{s}';")=='t'
 sql(f"set role authenticated;set request.jwt.claim.sub='{a}';select delete_history_session('{s}');")
 upload(a,s,[caption(revision=99)])
 assert sql(f"select jsonb_array_length(transcript)||':'||(summary is null)::text||':'||segment_count from caption_sessions where id='{s}';")=='0:true:0'
 assert sql(f"select count(*) from usage_reservations where owner_id='{a}';")=='1'
 sql(f"delete from auth.users where id='{a}';")
 assert sql('select count(*) from caption_sessions;')=='0'
 assert sql(f"select count(*) from usage_reservations where owner_id='{a}';")=='0'
 sql(f"delete from auth.users where id='{b}';")
 assert sql(f"select count(*) from billing_accounts where owner_id='{b}';")=='0'
 # Optional Supabase advisors against this disposable cluster, never the linked project.
 if os.environ.get('AUDEEO_DATABASE_ADVISORS') == '1':
  from urllib.parse import quote
  db_url = f"postgresql:///postgres?host={quote(env['PGHOST'], safe='')}&port={env['PGPORT']}&sslmode=disable"
  try:
   result = run('npx','--yes','supabase@2.117.0','db','advisors','--db-url',db_url,'--type','all','--level','warn','--fail-on','error')
   print(result.stdout)
  except subprocess.CalledProcessError as error:
   error.add_note(error.stdout + error.stderr)
   raise
 print('PASS: populated migration preservation, five-table schema, completed document uploads, concurrent JSON merge, summary compare-and-set, cross-owner rejection, service-only subscription identity and metering, usage snapshots, concurrent reservations, duplicates, restoration, stale entitlements, expiration, deletion tombstones, account cascade')
finally:
 subprocess.run(['pg_ctl','-D',str(work/'data'),'-m','immediate','stop'],capture_output=True,env=env)
 shutil.rmtree(work)
