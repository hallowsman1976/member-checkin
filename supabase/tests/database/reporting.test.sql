-- Run with `npm run db:test` (local Supabase, seed applied).
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Fixtures: 12 registrations via the real RPC from 3 stations, then 1 cancelled.
set local role authenticated;
select pg_temp.act_as('10000000-0000-0000-0000-000000000003'); -- staff1 / S01
select public.register_member('30000000-0000-0000-0000-000000000001', id)
  from public.members where member_no in ('000123', '001234', '012345', '900001', '900002');
select pg_temp.act_as('10000000-0000-0000-0000-000000000004'); -- staff2 / S02
select public.register_member('30000000-0000-0000-0000-000000000001', id)
  from public.members where member_no in ('900003', '900004', '900005', '900006');
select pg_temp.act_as('10000000-0000-0000-0000-000000000005'); -- staff3 / S03
select public.register_member('30000000-0000-0000-0000-000000000001', id)
  from public.members where member_no in ('900007', '900008', '900009');
reset role;
update public.checkins
  set status = 'cancelled', cancelled_at = now(),
      cancelled_by = '10000000-0000-0000-0000-000000000001', cancel_reason = 'ลงผิดคน'
  where member_id = (select id from public.members where member_no = '900009');

create temp table expected as
select
  (select count(*) from public.event_members where event_id = '30000000-0000-0000-0000-000000000001')::int as eligible,
  (select count(*) from public.checkins
    where event_id = '30000000-0000-0000-0000-000000000001' and status = 'active')::int as registered;
grant select on expected to authenticated;

-- Dashboard ------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('10000000-0000-0000-0000-000000000002'); -- supervisor
create temp table stats as select public.get_dashboard_stats('30000000-0000-0000-0000-000000000001') as s;

select is((select (s ->> 'eligible')::int from stats), (select eligible from expected), 'eligible equals event_members count');
select is((select (s ->> 'registered')::int from stats), 11, 'registered counts active check-ins only');
select is((select (s ->> 'registered')::int from stats), (select registered from expected), 'registered equals checkins table');
select is(
  (select (s ->> 'remaining')::int from stats), (select eligible - registered from expected),
  'remaining = eligible - registered'
);
select is((select (s ->> 'cancelled')::int from stats), 1, 'cancelled is reported separately');
select is(
  (select sum((x ->> 'registered')::int)::int from stats, jsonb_array_elements(s -> 'by_station') x),
  11, 'station breakdown sums to registered'
);
select is(
  (select (x ->> 'registered')::int from stats, jsonb_array_elements(s -> 'by_station') x where x ->> 'station_code' = 'S03'),
  2, 'cancelled check-in is excluded from its station'
);
select is(
  (select sum((x ->> 'eligible')::int)::int from stats, jsonb_array_elements(s -> 'by_member_type') x),
  (select eligible from expected), 'member type breakdown sums to eligible'
);
select is(
  (select (x ->> 'registered')::int from stats, jsonb_array_elements(s -> 'by_member_type') x where x ->> 'member_type' = 'associate'),
  1, 'associate registrations counted'
);
select is((select jsonb_array_length(s -> 'recent') from stats), 10, 'recent list is capped at 10');

select pg_temp.act_as('10000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.get_dashboard_stats('30000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'staff cannot read the dashboard'
);

-- History scoping --------------------------------------------------------------
select is(
  (public.list_checkins('30000000-0000-0000-0000-000000000001') ->> 'total')::int, 5,
  'staff history shows only their own check-ins'
);
select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select is(
  (public.list_checkins('30000000-0000-0000-0000-000000000001') ->> 'total')::int, 12,
  'admin history shows all check-ins including cancelled'
);
select is(
  (public.list_checkins('30000000-0000-0000-0000-000000000001', p_status => 'cancelled') -> 'rows' -> 0 ->> 'cancel_reason'),
  'ลงผิดคน', 'history exposes the cancel reason'
);
select is(
  (public.list_checkins('30000000-0000-0000-0000-000000000001', p_station_id => '20000000-0000-0000-0000-000000000002') ->> 'total')::int,
  4, 'history filters by station'
);
select is(
  (public.list_checkins('30000000-0000-0000-0000-000000000001', p_from => now() + interval '1 hour') ->> 'total')::int,
  0, 'history filters by time'
);

-- Reports ----------------------------------------------------------------------
select is(
  (public.get_report('30000000-0000-0000-0000-000000000001', 'registered') ->> 'total')::int
    + (public.get_report('30000000-0000-0000-0000-000000000001', 'unregistered') ->> 'total')::int,
  (select eligible from expected), 'registered + unregistered = eligible'
);
select is(
  (public.get_report('30000000-0000-0000-0000-000000000001', 'unregistered') -> 'rows')
    @> '[{"member_no": "900009"}]'::jsonb,
  true, 'a cancelled member is listed as unregistered'
);

-- Exports are audited ------------------------------------------------------------
select is(
  (select count(*)::int from public.export_report('30000000-0000-0000-0000-000000000001', 'xlsx', 'registered')),
  11, 'export returns every matching row'
);
reset role;
select results_eq(
  $$select action, details ->> 'row_count', details ->> 'format', actor_id::text
    from public.audit_logs order by created_at desc limit 1$$,
  $$values ('report.export', '11', 'xlsx', '10000000-0000-0000-0000-000000000001')$$,
  'export writes an audit entry with actor, format and row count'
);

set local role authenticated;
select pg_temp.act_as('10000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select * from public.export_report('30000000-0000-0000-0000-000000000001', 'csv')$$,
  '42501', null, 'staff cannot export'
);
select throws_ok(
  $$select public.get_report('30000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'staff cannot read reports'
);
reset role;

select * from finish();
rollback;
