-- Run with `npm run db:test` (local Supabase, seed applied).
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.member_id(p_no text) returns uuid language sql as $$
  select id from public.members where member_no = p_no;
$$;
create function pg_temp.register(p_no text) returns jsonb language sql as $$
  select public.register_member('30000000-0000-0000-0000-000000000001', pg_temp.member_id(p_no));
$$;

-- Owner-side fixtures
insert into public.members (member_no, full_name, member_type) values ('777777', 'ไม่มี สิทธิ์', 'ordinary');
insert into public.events (id, title, event_date, status)
  values ('30000000-0000-0000-0000-0000000000d0', 'งานร่าง', '2027-01-01', 'draft');
insert into public.event_members (event_id, member_id)
  values ('30000000-0000-0000-0000-0000000000d0', pg_temp.member_id('001234'));
insert into public.staff_station_assignments (event_id, staff_id, station_id) values
  ('30000000-0000-0000-0000-0000000000d0', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001');

-- Search ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('10000000-0000-0000-0000-000000000003');

select is((select member_no from public.search_members('000123') limit 1), '000123', 'exact member no. ranks first');
select results_eq(
  $$select member_no from public.search_members('0001')$$,
  $$values ('000123'::text)$$,
  'leading-zero prefix matches only that prefix'
);
select is((select member_no from public.search_members('ใจดี') limit 1), '000123', 'Thai partial surname matches');
select is(
  (select member_no from public.search_members('  สมชาย   ใจ ') limit 1), '000123',
  'extra whitespace in a Thai name query is normalized'
);
select is((select count(*)::int from public.search_members('ไม่มีชื่อนี้')), 0, 'nonexistent name returns nothing');
select is((select count(*)::int from public.search_members('%')), 0, 'LIKE wildcards are matched literally');
select is((select count(*)::int from public.search_members('สมาชิกทดสอบ')), 20, 'results are capped at 20');
select results_eq(
  $$select is_active, is_eligible from public.search_members('100002')$$,
  $$values (false, false)$$,
  'inactive member is shown as inactive and ineligible'
);

-- Registration ---------------------------------------------------------------

select is(pg_temp.register('000123') ->> 'result', 'registered', 'first registration succeeds');
select is(
  (select checkin_status::text from public.search_members('000123') limit 1), 'active',
  'search shows the new registration'
);
select results_eq(
  $$select r ->> 'result', r -> 'checkin' ->> 'station_code', r -> 'checkin' ->> 'staff_id'
    from (select pg_temp.register('000123') as r) x$$,
  $$values ('already_registered', 'S01', '10000000-0000-0000-0000-000000000003')$$,
  'repeat request returns already_registered with the original station and staff'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000004');
select results_eq(
  $$select r ->> 'result', r -> 'checkin' ->> 'station_code' from (select pg_temp.register('000123') as r) x$$,
  $$values ('already_registered', 'S01')$$,
  'another station sees already_registered with the original station'
);
select is(
  (select count(*)::int from public.checkins where member_id = pg_temp.member_id('000123')),
  1, 'exactly one check-in row exists'
);

select is(pg_temp.register('100002') ->> 'code', 'member_inactive', 'inactive member is rejected');
select is(pg_temp.register('777777') ->> 'code', 'member_not_eligible', 'member outside event_members is rejected');
select is(
  public.register_member('30000000-0000-0000-0000-000000000001', gen_random_uuid()) ->> 'code',
  'member_not_found', 'unknown member id is rejected (never auto-created)'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000003');
select is(
  public.register_member('30000000-0000-0000-0000-0000000000d0', pg_temp.member_id('001234')) ->> 'code',
  'event_not_open', 'draft event is rejected'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000002');
select is(pg_temp.register('001234') ->> 'code', 'forbidden', 'supervisor cannot register');

select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select is(pg_temp.register('012345') ->> 'result', 'registered', 'admin with an assignment can register');

-- Status lookup for unknown outcomes
select pg_temp.act_as('10000000-0000-0000-0000-000000000003');
select is(
  public.get_checkin_status('30000000-0000-0000-0000-000000000001', pg_temp.member_id('001234')) ->> 'result',
  'not_registered', 'status reports not_registered'
);
select is(
  public.get_checkin_status('30000000-0000-0000-0000-000000000001', pg_temp.member_id('000123')) ->> 'result',
  'active', 'status reports an active check-in'
);

-- Owner-side state changes, then re-check as staff ---------------------------
reset role;
update public.staff_profiles set is_active = false where id = '10000000-0000-0000-0000-000000000004';
update public.staff_station_assignments set is_active = false
  where staff_id = '10000000-0000-0000-0000-000000000005';
update public.stations set is_active = false where station_code = 'S04';
update public.checkins
  set status = 'cancelled', cancelled_at = now(),
      cancelled_by = '10000000-0000-0000-0000-000000000001', cancel_reason = 'ทดสอบ'
  where member_id = pg_temp.member_id('000123');
set local role authenticated;

select pg_temp.act_as('10000000-0000-0000-0000-000000000004');
select is(pg_temp.register('001234') ->> 'code', 'staff_inactive', 'inactive staff is rejected');

select pg_temp.act_as('10000000-0000-0000-0000-000000000005');
select is(pg_temp.register('001234') ->> 'code', 'no_station', 'staff without an active assignment is rejected');

select pg_temp.act_as('10000000-0000-0000-0000-000000000006');
select is(pg_temp.register('001234') ->> 'code', 'station_inactive', 'inactive station is rejected');

select pg_temp.act_as('10000000-0000-0000-0000-000000000003');
select is(pg_temp.register('000123') ->> 'result', 'cancelled', 'cancelled check-in is not silently re-registered');
select is(
  public.get_checkin_status('30000000-0000-0000-0000-000000000001', pg_temp.member_id('000123')) ->> 'result',
  'cancelled', 'status reports cancelled'
);

-- Closed event
reset role;
update public.events set status = 'closed' where id = '30000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.act_as('10000000-0000-0000-0000-000000000003');
select is(pg_temp.register('001234') ->> 'code', 'event_not_open', 'closed event is rejected');
reset role;

-- Privileges -----------------------------------------------------------------
set local role anon;
select throws_ok(
  $$select public.register_member('30000000-0000-0000-0000-000000000001', gen_random_uuid())$$,
  '42501', null, 'anon cannot call register_member'
);
select throws_ok(
  $$select * from public.search_members('000123')$$,
  '42501', null, 'anon cannot call search_members'
);
reset role;

select * from finish();
rollback;
