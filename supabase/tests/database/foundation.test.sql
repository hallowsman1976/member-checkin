-- Run with `npm run db:test` (local Supabase, seed applied).
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Schema constraints ---------------------------------------------------------

select throws_ok(
  $$insert into public.events (title, event_date, status) values ('อีกงาน', '2026-12-21', 'open')$$,
  '23505', null, 'only one event can be open'
);

select lives_ok(
  $$insert into public.events (title, event_date, status) values ('งานร่าง', '2027-01-10', 'draft')$$,
  'draft events are unrestricted'
);

select throws_ok(
  $$insert into public.staff_station_assignments (event_id, staff_id, station_id)
    values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003',
            '20000000-0000-0000-0000-000000000003')$$,
  '23505', null, 'staff has at most one active assignment per event'
);

select throws_ok(
  $$insert into public.checkins (event_id, member_id, staff_id, station_id)
    select '30000000-0000-0000-0000-000000000001', m.id,
           '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001'
    from public.members m where m.member_no = '100002'$$,
  '23503', null, 'ineligible member cannot be checked in'
);

select lives_ok(
  $$insert into public.checkins (event_id, member_id, staff_id, station_id)
    select '30000000-0000-0000-0000-000000000001', m.id,
           '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001'
    from public.members m where m.member_no = '000123'$$,
  'eligible member can be checked in (as owner)'
);

select throws_ok(
  $$insert into public.checkins (event_id, member_id, staff_id, station_id)
    select '30000000-0000-0000-0000-000000000001', m.id,
           '10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002'
    from public.members m where m.member_no = '000123'$$,
  '23505', null, 'second check-in for the same member and event is rejected'
);

select throws_ok(
  $$update public.checkins set status = 'cancelled'
    where member_id = (select id from public.members where member_no = '000123')$$,
  '23514', null, 'cancellation requires cancelled_at, cancelled_by and reason'
);

select is(
  (select member_no from public.members where member_no = '000123'),
  '000123', 'member_no keeps leading zeros'
);

insert into public.audit_logs (action) values ('test.append');
select throws_ok(
  $$update public.audit_logs set action = 'tampered'$$,
  '42501', null, 'audit_logs rejects UPDATE even for the owner'
);
select throws_ok(
  $$delete from public.audit_logs$$,
  '42501', null, 'audit_logs rejects DELETE even for the owner'
);

-- Client privileges ----------------------------------------------------------

set local role anon;
select throws_ok($$select count(*) from public.members$$, '42501', null, 'anon cannot read members');
reset role;

-- staff1
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';

select ok((select count(*) from public.members) > 0, 'active staff can read members');
select throws_ok(
  $$insert into public.checkins (event_id, member_id, staff_id, station_id)
    select '30000000-0000-0000-0000-000000000001', m.id,
           '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001'
    from public.members m where m.member_no = '001234'$$,
  '42501', null, 'staff cannot insert check-ins directly'
);
select throws_ok(
  $$update public.staff_profiles set role = 'admin' where id = auth.uid()$$,
  '42501', null, 'staff cannot escalate own role'
);
select is((select count(*)::int from public.audit_logs), 0, 'staff cannot read audit logs');
select is(
  (select public.get_my_context() -> 'station' ->> 'station_code'),
  'S01', 'context returns the assigned station'
);
reset role;

-- deactivated staff2
update public.staff_profiles set is_active = false where id = '10000000-0000-0000-0000-000000000004';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.members), 0, 'inactive staff sees no members');
select is(
  (select (public.get_my_context() -> 'staff' ->> 'is_active')::boolean),
  false, 'inactive staff context reports is_active = false'
);
reset role;

select * from finish();
rollback;
