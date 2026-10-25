-- Security regressions: run with `npm run db:test`. Fails when a future migration
-- forgets RLS, grants, or search_path hardening.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  null, 'every public table has RLS enabled'
);

select is(
  (select array_agg(table_name::text order by table_name) from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'PUBLIC')),
  null, 'anon and PUBLIC have no table privileges'
);

select is(
  (select array_agg(distinct table_name::text order by table_name::text) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'),
  null, 'authenticated clients can only SELECT tables (all writes go through RPCs)'
);

select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and (has_function_privilege('anon', p.oid, 'execute') or p.proacl is null)),
  null, 'no public/private function is executable by anon or PUBLIC'
);

select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not coalesce('search_path=""' = any (p.proconfig), false)),
  null, 'every SECURITY DEFINER function pins search_path to empty'
);

-- get_checkin_status scoping (staff limited to the open event).
insert into public.events (id, title, event_date, status)
  values ('30000000-0000-0000-0000-0000000000c0', 'งานเก่า', '2025-12-20', 'closed');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(
  public.get_checkin_status('30000000-0000-0000-0000-0000000000c0', gen_random_uuid()) ->> 'code',
  'event_not_open', 'staff cannot look up check-ins of a non-open event'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(
  public.get_checkin_status('30000000-0000-0000-0000-0000000000c0', gen_random_uuid()) ->> 'result',
  'not_registered', 'supervisor can look up any event'
);
reset role;

select * from finish();
rollback;
