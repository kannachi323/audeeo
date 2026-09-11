#!/usr/bin/env python3
"""Run the real migration against an isolated, disposable local PostgreSQL cluster."""
import concurrent.futures, os, pathlib, shutil, subprocess, tempfile
root=pathlib.Path(__file__).resolve().parents[1]
work=pathlib.Path(tempfile.mkdtemp(prefix='audeeo-pg-'))
env={**os.environ,'PGHOST':str(work),'PGPORT':'55439','PGDATABASE':'postgres'}
def run(*args,**kw):return subprocess.run(args,check=True,text=True,capture_output=True,env=env,**kw)
def sql(text):
 try:return run('psql','-X','-v','ON_ERROR_STOP=1','-At','-c',text).stdout.strip()
 except subprocess.CalledProcessError as error:
  error.add_note(error.stderr)
  raise
try:
 run('initdb','-D',str(work/'data'),'-A','trust','--no-locale')
 run('pg_ctl','-D',str(work/'data'),'-l',str(work/'postgres.log'),'-o',f"-k {work} -p 55439 -c listen_addresses=''",'start')
 sql("""create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public to authenticated,anon,service_role;
 grant execute on function auth.uid() to authenticated;
 """)
 for migration in sorted((root/'supabase/migrations').glob('*.sql')):
  run('psql','-X','-v','ON_ERROR_STOP=1','-f',str(migration))
 a='11111111-1111-4111-8111-111111111111';b='22222222-2222-4222-8222-222222222222';s='33333333-3333-4333-8333-333333333333'
 sql(f"insert into auth.users values('{a}'),('{b}'); update commercial_config set free_seconds=60,monthly_seconds=120;")
 sql(f"set role authenticated;set request.jwt.claim.sub='{a}';insert into sessions(id,owner_id,source_language,target_language) values('{s}','{a}','zh','en');insert into segments values('seg','{s}','{a}',0,1,0,1000,'zh','en','你好','hello','complete');")
 assert sql(f"set role authenticated;set request.jwt.claim.sub='{b}';select count(*) from segments;").splitlines()[-1]=='0'
 assert sql(f"set role authenticated;set request.jwt.claim.sub='{b}';select count(*) from sessions;").splitlines()[-1]=='0'
 sql(f"set role authenticated;set request.jwt.claim.sub='{b}';update segments set source_text='attack' where id='seg';delete from segments where id='seg';select delete_history_session('{s}');")
 assert sql("select source_text from segments where id='seg';")=='你好'
 assert sql(f"select deleted_at is null from sessions where id='{s}';")=='t'
 for query in ["set role anon;select * from sessions;", "set role anon;select * from segments;", "set role authenticated;select * from allowances;", f"set role authenticated;set request.jwt.claim.sub='{a}';update segments set owner_id='{b}' where id='seg';", f"set role authenticated;set request.jwt.claim.sub='{a}';delete from sessions where id='{s}';", f"set role authenticated;select apply_entitlement('{a}',now(),now(),now(),true);"]:
  try:sql(query);raise AssertionError('unauthorized operation accepted')
  except subprocess.CalledProcessError:pass
 try:sql(f"set role authenticated;set request.jwt.claim.sub='{b}';insert into segments values('attack','{s}','{b}',0,1,0,1000,'zh','en','secret','','pending');");raise AssertionError('cross-owner write accepted')
 except subprocess.CalledProcessError:pass
 try:sql(f"set role authenticated;select reserve_usage('{a}','{s}',99,15);");raise AssertionError('client can grant usage')
 except subprocess.CalledProcessError:pass
 # Expanded captions remain saveable; malformed codes are still rejected.
 for source,target in [('ja','fr'),('ar','en'),('auto','auto'),('yue','yue'),('zh-tw','zh-tw')]:
  language_session='44444444-4444-4444-8444-444444444444'
  sql(f"begin;set role authenticated;set request.jwt.claim.sub='{a}';insert into sessions(id,owner_id,source_language,target_language) values('{language_session}','{a}','{source}','{target}');insert into segments values('language-test','{language_session}','{a}',0,1,0,1000,'{source}','{target}','text','','complete');do $$ begin if not exists(select 1 from segments where id='language-test' and source_language='{source}' and target_language='{target}') then raise exception 'Language history was not saved'; end if; end $$;rollback;")
 for table in ['sessions','segments']:
  try:sql(f"update {table} set source_language='not-a-language';");raise AssertionError('malformed language accepted')
  except subprocess.CalledProcessError:pass
 # Simultaneous sessions and duplicate reservations share one locked allowance.
 def reserve(i):return int(sql(f"set role service_role;select reserve_usage('{a}','{s}',{i},15);").splitlines()[-1])
 with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool: list(pool.map(reserve,range(20)))
 assert sql(f"select sum(seconds) from usage_ledger where owner_id='{a}';")=='60'
 assert reserve(0) in (0,15)
 assert sql(f"select sum(seconds) from usage_ledger where owner_id='{a}';")=='60'
 sql(f"select apply_entitlement('{a}',now()-interval '1 day',now()+interval '29 days',now(),true);")
 assert int(sql(f"select reserve_usage('{a}','{s}',100,15);"))==15
 # Restoration of same period preserves usage; stale events cannot revoke newer state.
 sql(f"select apply_entitlement('{a}',(select period_start from allowances where owner_id='{a}'),(select period_end from allowances where owner_id='{a}'),now()+interval '1 second',true);select apply_entitlement('{a}',null,null,now()-interval '1 day',false);")
 assert sql(f"select used_seconds||':'||paid::text from allowances where owner_id='{a}';")=='15:true'
 sql(f"select apply_entitlement('{a}',now()-interval '31 days',now()-interval '1 day',now()+interval '2 seconds',false);")
 assert sql(f"select reserve_usage('{a}','{s}',101,15);")=='0'
 # Tombstone deletion survives late offline replay.
 sql(f"set role authenticated;set request.jwt.claim.sub='{a}';select delete_history_session('{s}');")
 assert sql('select count(*) from segments;')=='0'
 try:sql(f"set role authenticated;set request.jwt.claim.sub='{a}';insert into segments values('seg','{s}','{a}',0,1,0,1000,'zh','en','你好','hello','complete');");raise AssertionError('deleted history resurrected')
 except subprocess.CalledProcessError:pass
 sql(f"delete from auth.users where id='{a}';")
 assert sql('select count(*) from sessions;')=='0'
 assert sql('select count(*) from usage_ledger;')=='0'
 print('PASS: migration, RLS isolation, cross-owner rejection, service-only metering, concurrent reservations, duplicates, restoration, stale entitlements, expiration, deletion tombstones, account cascade')
finally:
 subprocess.run(['pg_ctl','-D',str(work/'data'),'-m','immediate','stop'],capture_output=True,env=env)
 shutil.rmtree(work)
