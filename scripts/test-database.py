#!/usr/bin/env python3
"""Run the real migration against an isolated, disposable local PostgreSQL cluster."""
import concurrent.futures, json, os, pathlib, shutil, subprocess, sys, tempfile, uuid
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
  granting_free = migration.name.endswith('_grant_thirty_free_minutes.sql')
  if granting_free:
   sql(f"insert into auth.users values('{fixture_owner}','free-migration@example.com'); insert into billing_accounts(owner_id,free_used_seconds) values('{fixture_owner}',600);")
   previous_monthly = sql('select monthly_seconds from billing_settings where singleton;')
  run('psql','-X','-v','ON_ERROR_STOP=1','-f',str(migration))
  if granting_free:
   assert sql(f"select free_used_seconds from billing_accounts where owner_id='{fixture_owner}';") == '600'
   assert sql(f"select account_usage('{fixture_owner}')->>'remainingSeconds';") == '1200'
   assert sql('select monthly_seconds from billing_settings where singleton;') == previous_monthly
   sql(f"delete from auth.users where id='{fixture_owner}';")
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
 if os.environ.get('AUDEEO_DATABASE_CANDIDATE'):
  run('psql','-X','-v','ON_ERROR_STOP=1','-f',os.environ['AUDEEO_DATABASE_CANDIDATE'])
 a='11111111-1111-4111-8111-111111111111';b='22222222-2222-4222-8222-222222222222';s='33333333-3333-4333-8333-333333333333'
 # The configured free grant is real metered credit, including for existing accounts.
 free_owner='abababab-abab-4bab-8bab-abababababab'
 sql(f"insert into auth.users values('{free_owner}','free-allowance@example.com');")
 assert sql('select free_seconds from billing_settings where singleton;') == '1800'
 fresh=json.loads(sql(f"select account_usage('{free_owner}');"))
 assert fresh['includedSeconds']==1800 and fresh['remainingSeconds']==1800 and fresh['usedSeconds']==0 and not fresh['active']
 first_lease=str(uuid.uuid4())
 reserve_free=f"set role service_role;select reserve_metered_usage('{free_owner}','{s}','{first_lease}',1,false);"
 assert sql(reserve_free).splitlines()[-1]=='15'
 assert sql(reserve_free).splitlines()[-1]=='15'
 sql(f"set role service_role;select settle_metered_usage('{free_owner}','{first_lease}',6,true);")
 assert sql(f"select account_usage('{free_owner}')->>'remainingSeconds';")=='1794'
 voice_lease=str(uuid.uuid4())
 assert sql(f"set role service_role;select reserve_metered_usage('{free_owner}','{s}','{voice_lease}',3,false);").splitlines()[-1]=='45'
 sql(f"set role service_role;select settle_metered_usage('{free_owner}','{voice_lease}',45,true);")
 assert sql(f"select account_usage('{free_owner}')->>'remainingSeconds';")=='1749'
 def spend_free(_):
  lease=str(uuid.uuid4())
  amount=int(sql(f"set role service_role;select reserve_metered_usage('{free_owner}','{s}','{lease}',3,false);").splitlines()[-1])
  sql(f"set role service_role;select settle_metered_usage('{free_owner}','{lease}',{amount},true);")
  return amount
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
  assert sum(pool.map(spend_free,range(48)))==1749
 assert sql(f"select account_usage('{free_owner}')->>'remainingSeconds';")=='0'
 assert spend_free(49)==0
 # A paid period and subsequent cancellation cannot replenish lifetime credit.
 sql(f"select apply_entitlement('{free_owner}',now()-interval '1 day',now()+interval '29 days',now(),true,'rc-free','sub-free','audeeo_pro','monthly','stripe');")
 assert sql(f"select account_usage('{free_owner}')->>'includedSeconds';")=='36000'
 sql(f"select apply_entitlement('{free_owner}',null,null,now()+interval '1 second',false,'rc-free','sub-free','audeeo_pro','monthly','stripe');")
 assert sql(f"select account_usage('{free_owner}')->>'remainingSeconds';")=='0'
 assert sql(f"select free_used_seconds from billing_accounts where owner_id='{free_owner}';")=='1800'
 sql(f"delete from auth.users where id='{free_owner}';")
 print('PASS: 30-minute lifetime free allowance, existing usage preservation, weighted charging, refunds, concurrent exhaustion, and no reset after cancellation')
 # Revoking one development exemption must restore ordinary limits without
 # changing the other account or preventing subsequent purchased-minute use.
 revoked='66666666-6666-4666-8666-666666666666'
 sql(f"insert into auth.users values('{revoked}','mattdev727@gmail.com'); update billing_settings set free_seconds=0;")
 assert sql(f"select private.has_unlimited_usage('{revoked}')") == 'f'
 assert sql(f"select account_usage('{revoked}')->>'unlimited'") == 'false'
 assert sql(f"set role service_role;select reserve_metered_usage('{revoked}','{s}','55555555-5555-4555-8555-555555555555',1,false)").splitlines()[-1] == '0'
 sql(f"delete from auth.users where id='{revoked}';")
 sql(f"insert into auth.users values('{a}','mtccool668@gmail.com'),('{b}','user@example.com'); update billing_settings set free_seconds=60,monthly_seconds=120;")
 assert sql(f"select private.has_unlimited_usage('{a}')") == 't'
 def caption(id='seg', **overrides):
  return dict(id=id,sequence=0,revision=1,start_ms=0,end_ms=1000,source_language='zh',target_language='en',source_text='source text',translated_text='hello',state='complete',**{}) | overrides
 def upload(owner, session_id, items):
  payload=json.dumps(items).replace("'", "''")
  return sql(f"set role authenticated;set request.jwt.claim.sub='{owner}';select sync_caption_session('{session_id}','{payload}'::jsonb,date_trunc('day',now())-interval '1 day');")
 def denied(query):
  try:sql(query);raise AssertionError('unauthorized or invalid operation accepted')
  except subprocess.CalledProcessError:pass
 def summary(owner, session_id, version=None):
  if version is None: version=sql(f"select transcript_version from caption_sessions where id='{session_id}'")
  payload=json.dumps(dict(language='en',content={'title':'Summary'},source_hash='a'*64,request_hash='b'*64,model='test')).replace("'", "''")
  return sql(f"set role service_role;select save_caption_summary('{owner}','{session_id}',{version},'{payload}'::jsonb)")
 upload(a,s,[caption()])
 assert sql(f"select started_at = date_trunc('day',now())-interval '1 day' from caption_sessions where id='{s}'")=='t'
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
 # Retention/preferences run against real Postgres, including concurrent replay.
 if sql("select to_regclass('public.session_history_settings') is not null;")=='t':
  pref=lambda owner,enabled: sql(f"set role authenticated;set request.jwt.claim.sub='{owner}';select set_session_history_settings({str(enabled).lower()});")
  pref(a,False)
  assert sql(f"select jsonb_array_length(transcript)||':'||(summary is null)::text||':'||lifecycle_state from caption_sessions where id='{s}';")=='0:true:deleted'
  assert sql(f"set role authenticated;set request.jwt.claim.sub='{a}';select count(*) from caption_sessions;").splitlines()[-1]=='0'
  pref(a,True)
  upload(a,s,[caption(revision=99)])
  assert sql(f"select segment_count from caption_sessions where id='{s}';")=='0'
  new_session='66666666-6666-4666-8666-666666666666'
  payload=json.dumps([caption()]).replace("'","''")
  upload(a,new_session,[caption()])
  assert sql(f"select count(*) from caption_sessions where id='{new_session}';")=='0'
  sql(f"set role authenticated;set request.jwt.claim.sub='{a}';select sync_caption_session('{new_session}','{payload}',now(),3);")
  assert sql(f"select segment_count from caption_sessions where id='{new_session}';")=='1'
  expires=sql(f"select expires_at from caption_sessions where id='{new_session}';")
  sql(f"set role authenticated;set request.jwt.claim.sub='{a}';select sync_caption_session('{new_session}','{payload}',now()+interval '1 day',3);")
  assert sql(f"select expires_at from caption_sessions where id='{new_session}';")==expires
  denied(f"set role anon;select get_session_history_settings();")
  denied(f"set role authenticated;set request.jwt.claim.sub='{b}';update session_history_settings set save_sessions=false where owner_id='{a}';")
  denied(f"set role authenticated;set request.jwt.claim.sub='{a}';select private.merge_caption_document('{new_session}','{payload}',now());")
  # Seed an overdue saved document as if the wall clock advanced after saving.
  sql(f"alter table caption_sessions disable trigger enforce_caption_retention;update caption_sessions set expires_at=now()-interval '1 second' where id='{new_session}';alter table caption_sessions enable trigger enforce_caption_retention;")
  assert sql(f"set role authenticated;set request.jwt.claim.sub='{a}';select count(*) from caption_sessions;").splitlines()[-1]=='0'
  assert sql('select private.expire_caption_sessions();')=='1'
  assert sql(f"select segment_count||':'||lifecycle_state from caption_sessions where id='{new_session}';")=='0:expired'
  sql(f"set role authenticated;set request.jwt.claim.sub='{a}';select sync_caption_session('{new_session}','{payload}',now(),3);")
  assert sql(f"select segment_count from caption_sessions where id='{new_session}';")=='0'
  assert sql("select count(*) from pg_indexes where indexname='caption_sessions_expiry_idx';")=='1'
  # Toggle-off serializes with concurrent writes: either order must leave no content.
  racing='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  def racing_upload(i):
   return sql(f"set role authenticated;set request.jwt.claim.sub='{a}';select sync_caption_session('{racing}','{payload}',now(),3);")
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
   futures=[pool.submit(racing_upload,i) for i in range(12)]
   futures.append(pool.submit(pref,a,False))
   for future in futures: future.result()
  assert sql(f"select count(*) from caption_sessions where owner_id='{a}' and (deleted_at is null or transcript<>'[]'::jsonb or summary is not null);")=='0'
  pref(a,True)
  racing_upload(99)
  assert sql(f"select count(*) from caption_sessions where id='{racing}' and segment_count>0;")=='0'
  # Restore the original fixture as saved for the pre-existing deletion assertions.
  sql(f"alter table caption_sessions disable trigger user;update caption_sessions set deleted_at=null,deletion_reason=null where id='{s}';alter table caption_sessions enable trigger user;")
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
 # Minute wallets: real PostgreSQL concurrency, refund tombstones, weighted leases and RLS.
 sql(f"insert into auth.users values('{a}','wallet-a@example.com'),('{b}','wallet-b@example.com');update billing_settings set free_seconds=0;")
 grant=f"select apply_minute_purchase('{a}','app_store','PRODUCTION','pack-1','audeeo_minutes_60',now(),false);"
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: list(pool.map(lambda _:sql(grant),range(8)))
 assert sql(f"select account_usage('{a}')->>'purchasedSeconds';")=='3600'
 assert sql("select count(*) from minute_credit_ledger where kind='purchase';")=='1'
 lease='44444444-4444-4444-8444-444444444444'
 reserve=f"select reserve_metered_usage('{a}','{s}','{lease}',3,true);"
 assert sql(reserve)=='45';assert sql(reserve)=='45'
 assert sql(f"select account_usage('{a}')->>'purchasedSeconds';")=='3555'
 sql(f"select settle_metered_usage('{a}','{lease}',30,true);select settle_metered_usage('{a}','{lease}',0,true);")
 assert sql(f"select account_usage('{a}')->>'purchasedSeconds';")=='3570'
 sql(f"select apply_minute_purchase('{a}','app_store','PRODUCTION','pack-1','audeeo_minutes_60',now(),true);")
 sql(grant)
 assert sql(f"select account_usage('{a}')->>'purchasedSeconds';")=='0'
 sql(f"select apply_minute_purchase('{a}','app_store','PRODUCTION','refund-first','audeeo_minutes_60',now(),true);select apply_minute_purchase('{a}','app_store','PRODUCTION','refund-first','audeeo_minutes_60',now(),false);")
 assert sql(f"select account_usage('{a}')->>'purchasedSeconds';")=='0'
 sql(f"select apply_minute_purchase('{a}','app_store','SANDBOX','sandbox','audeeo_minutes_600',now(),false);")
 assert sql(f"select account_usage('{a}')->>'purchasedSeconds';")=='0'
 sql(f"select apply_minute_purchase('{a}','app_store','PRODUCTION','pack-2','audeeo_minutes_60',now(),false);")
 lease2='55555555-5555-4555-8555-555555555555'
 assert sql(f"select reserve_metered_usage('{a}','{s}','{lease2}',1,false);")=='0'
 lease3='66666666-6666-4666-8666-666666666666'
 assert sql(f"select reserve_metered_usage('{a}','{s}','{lease3}',3,true);")=='45'
 sql(f"select settle_metered_usage('{a}','{lease3}',6,false);update metered_usage_leases set expires_at=now()-interval '1 second' where id='{lease3}';select reconcile_usage_leases();")
 assert sql(f"select account_usage('{a}')->>'purchasedSeconds';")=='3594'
 # Immutable ownership and no public balance-writing RPCs.
 try: sql(f"select apply_minute_purchase('{b}','app_store','PRODUCTION','pack-2','audeeo_minutes_60',now(),false);");raise AssertionError('purchase reassigned')
 except subprocess.CalledProcessError: pass
 for role in ['anon','authenticated']:
  try: sql(f"set role {role};{reserve}");raise AssertionError('client reserved money')
  except subprocess.CalledProcessError: pass
 # A refund during an outstanding reservation never resurrects unused credit.
 lease4='77777777-7777-4777-8777-777777777777'
 assert sql(f"select reserve_metered_usage('{a}','{s}','{lease4}',3,true);")=='45'
 sql(f"select apply_minute_purchase('{a}','app_store','PRODUCTION','pack-2','audeeo_minutes_60',now(),true);select settle_metered_usage('{a}','{lease4}',9,true);")
 assert sql(f"select account_usage('{a}')->>'purchasedSeconds';")=='0'
 assert sql("select sum(seconds) from minute_credit_ledger where purchase_id=(select id from minute_pack_purchases where transaction_id='pack-2');")=='0'
 assert sql("select -sum(seconds) from minute_credit_ledger where kind='refund' and purchase_id=(select id from minute_pack_purchases where transaction_id='pack-2');")=='3585'
 assert sql("select refund_review from minute_pack_purchases where transaction_id='refund-first';")=='t'
 assert sql("select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity;")=='0'
 sql(f"delete from auth.users where id in ('{a}','{b}');")
 print('PASS: minute pack concurrency, single grants, unused refunds, refund-before-purchase, ownership, sandbox isolation, consent, weighted settlement, expired leases and RLS')
 # Bulk pack orders credit verified quantities once, including delayed quantities.
 sql(f"insert into auth.users values('{a}','bulk@example.test');update billing_settings set free_seconds=1800;")
 bulk=f"select apply_minute_purchase('{a}','app_store','PRODUCTION','bulk','audeeo_minutes_60',now(),false,3);"
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: list(pool.map(lambda _:sql(bulk),range(8)))
 assert sql(f"select account_usage('{a}')->>'totalRemainingSeconds';")=='12600' # 30 free + 180 purchased
 assert sql("select quantity||':'||granted_seconds from minute_pack_purchases where transaction_id='bulk';")=='3:10800'
 sql(f"update billing_accounts set free_used_seconds=1800 where owner_id='{a}';")
 bulk_lease=str(uuid.uuid4())
 assert sql(f"select reserve_metered_usage('{a}','{s}','{bulk_lease}',1,true);")=='15'
 sql(f"select settle_metered_usage('{a}','{bulk_lease}',10,true);")
 sql(f"select apply_minute_purchase('{a}','app_store','PRODUCTION','bulk','audeeo_minutes_60',now(),false);")
 assert sql(f"select account_usage('{a}')->>'purchasedSeconds';")=='10790'
 sql(f"select apply_minute_purchase('{a}','app_store','PRODUCTION','bulk','audeeo_minutes_60',now(),true);")
 sql(bulk)
 assert sql(f"select account_usage('{a}')->>'purchasedSeconds';")=='0'
 # Unknown quantities can arrive before verified bulk quantities, even after refund.
 for refunded in [False,True]:
  tx='late-quantity-'+str(refunded)
  sql(f"select apply_minute_purchase('{a}','app_store','PRODUCTION','{tx}','audeeo_minutes_60',now(),{str(refunded).lower()});")
  replay=f"select apply_minute_purchase('{a}','app_store','PRODUCTION','{tx}','audeeo_minutes_60',now(),false,4);"
  with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool: list(pool.map(lambda _:sql(replay),range(6)))
  assert sql(f"select quantity||':'||granted_seconds||':'||remaining_seconds from minute_pack_purchases where transaction_id='{tx}';")==f"4:14400:{0 if refunded else 14400}"
  assert sql(f"select sum(seconds) from minute_credit_ledger where purchase_id=(select id from minute_pack_purchases where transaction_id='{tx}');")==str(0 if refunded else 14400)
 for quantity in [0,-1,11]:
  denied(f"select apply_minute_purchase('{a}','app_store','PRODUCTION','invalid','audeeo_minutes_60',now(),false,{quantity});")
 for role in ['anon','authenticated']:
  denied(f"set role {role};{bulk}")
 sql(f"delete from auth.users where id='{a}';")
 print('PASS: bulk pack quantities, concurrent duplicates, free plus pack-only access, delayed quantity recovery, refunds and service-only grants')
 # Test subscriptions meter independently from production, with safe renewal boundaries.
 test_owner='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
 sql(f"insert into auth.users values('{test_owner}','sandbox-meter@example.test'); update billing_settings set free_seconds=1800,monthly_seconds=36000;")
 start=sql("select now()-interval '10 minutes';");end=sql("select now()+interval '50 minutes';")
 def sync_test(start_at=start,end_at=end,active=True,checked='now()'):
  return sql(f"set role service_role;select apply_sandbox_entitlement('{test_owner}',{str(active).lower()},'audeeo_pro_yearly','sandbox-sub','{start_at}','{end_at}',{checked});")
 def test_usage():return json.loads(sql(f"set role service_role;select sandbox_account_usage('{test_owner}');").splitlines()[-1])
 sync_test();assert test_usage()['remainingSeconds']==36000 and test_usage()['active']
 live_before=sql(f"select account_usage('{test_owner}');")
 test_lease=str(uuid.uuid4())
 test_reserve=f"set role service_role;select reserve_metered_usage('{test_owner}','{s}','{test_lease}',3,false,'SANDBOX');"
 assert sql(test_reserve).splitlines()[-1]=='45';assert sql(test_reserve).splitlines()[-1]=='45'
 sql(f"set role service_role;select settle_metered_usage('{test_owner}','{test_lease}',18,true);")
 sync_test();assert test_usage()['remainingSeconds']==35982
 assert sql(f"select account_usage('{test_owner}');")==live_before
 # Concurrent reservations cannot overspend the last subscription seconds.
 sql(f"update sandbox_billing_accounts set used_seconds=35960 where owner_id='{test_owner}';")
 ids=[str(uuid.uuid4()) for _ in range(12)]
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
  granted=list(pool.map(lambda lease:int(sql(f"set role service_role;select reserve_metered_usage('{test_owner}','{s}','{lease}',3,false,'SANDBOX');").splitlines()[-1]),ids))
 assert sum(granted)==40 and test_usage()['remainingSeconds']==0
 # A renewal grants once. Settling old reservations must not credit the new period.
 next_start=sql("select now()-interval '1 minute';");next_end=sql("select now()+interval '59 minutes';")
 sync_test(next_start,next_end);assert test_usage()['remainingSeconds']==36000
 for lease in ids:sql(f"select settle_metered_usage('{test_owner}','{lease}',0,true);")
 assert test_usage()['remainingSeconds']==36000
 renewal_lease=str(uuid.uuid4())
 sql(f"select reserve_metered_usage('{test_owner}','{s}','{renewal_lease}',1,false,'SANDBOX');select settle_metered_usage('{test_owner}','{renewal_lease}',10,true);")
 sync_test(next_start,next_end);sync_test();assert test_usage()['remainingSeconds']==35990
 sync_test(active=False,checked="now()-interval '1 day'");assert test_usage()['active']
 # Expiration/revocation falls back to the separate one-time free grant.
 sync_test(active=False);assert not test_usage()['active'] and test_usage()['remainingSeconds']==1800
 free_lease=str(uuid.uuid4())
 sql(f"select reserve_metered_usage('{test_owner}','{s}','{free_lease}',3,false,'SANDBOX');select settle_metered_usage('{test_owner}','{free_lease}',9,true);")
 assert test_usage()['remainingSeconds']==1791
 assert sql(f"select account_usage('{test_owner}');")==live_before
 # Pack consent and environment separation still apply after the test allowance ends.
 sql(f"update sandbox_billing_accounts set free_used_seconds=1800 where owner_id='{test_owner}';select apply_minute_purchase('{test_owner}','app_store','SANDBOX','sandbox-meter-pack','audeeo_minutes_60',now(),false);")
 assert sql(f"select reserve_metered_usage('{test_owner}','{s}','{uuid.uuid4()}',1,false,'SANDBOX');")=='0'
 pack_lease=str(uuid.uuid4())
 assert sql(f"select reserve_metered_usage('{test_owner}','{s}','{pack_lease}',3,true,'SANDBOX');")=='45'
 sql(f"select settle_metered_usage('{test_owner}','{pack_lease}',18,true);")
 assert test_usage()['purchasedSeconds']==3582
 assert sql(f"select account_usage('{test_owner}');")==live_before
 for role in ['anon','authenticated']:
  for statement in [f"select sandbox_account_usage('{test_owner}')",f"select * from sandbox_billing_accounts",f"select apply_sandbox_entitlement('{test_owner}',false,null,null,null,null,now())"]:
   try:sql(f"set role {role};{statement};");raise AssertionError('client accessed sandbox billing')
   except subprocess.CalledProcessError:pass
 sql(f"delete from auth.users where id='{test_owner}';")
 print('PASS: sandbox subscription allowance, renewal idempotency, concurrency, weighted usage, free credit, pack consent, production isolation and RLS')
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
