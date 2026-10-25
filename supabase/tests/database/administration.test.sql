-- Run with `npm run db:test` (local Supabase, seed applied).
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.audits(p_action text) returns int language sql as $$
  select count(*)::int from public.audit_logs where action = p_action;
$$;

-- Everything below runs as an authenticated client.
set local role authenticated;

-- Admin-only: every mutation is refused for staff and supervisors -------------
select pg_temp.act_as('10000000-0000-0000-0000-000000000003'); -- staff1
select throws_ok($$select public.import_members('[{"member_no":"1","full_name":"x","member_type":"ordinary"}]', false)$$,
  '42501', null, 'staff cannot import members');
select throws_ok($$select public.save_event(null, 'x', '2027-01-01')$$, '42501', null, 'staff cannot create events');
select throws_ok($$select public.cancel_checkin(gen_random_uuid(), 'x')$$, '42501', null, 'staff cannot cancel check-ins');
select throws_ok($$select * from public.list_staff()$$, '42501', null, 'staff cannot list staff accounts');
select pg_temp.act_as('10000000-0000-0000-0000-000000000002'); -- supervisor
select throws_ok($$select public.set_event_status('30000000-0000-0000-0000-000000000001', 'closed')$$,
  '42501', null, 'supervisor cannot change event status');
select throws_ok($$select public.assign_station('30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000003', null)$$, '42501', null, 'supervisor cannot change assignments');

select pg_temp.act_as('10000000-0000-0000-0000-000000000001'); -- admin

-- Import ---------------------------------------------------------------------
select is(
  public.import_members('[
    {"member_no":"000123","full_name":"สมชาย ใจดี","department":"สสจ.มุกดาหาร","member_type":"ordinary"},
    {"member_no":"001234","full_name":"สมหญิง  รักงาน (ย้าย)","department":"รพ.ใหม่","member_type":"ordinary"},
    {"member_no":"000999","full_name":"สมาชิก ใหม่","member_type":"associate"}
  ]', true),
  '{"ok": true, "dry_run": true, "inserted": 1, "updated": 1, "unchanged": 1}'::jsonb,
  'dry run reports insert/update/unchanged'
);
select is((select count(*)::int from public.members where member_no = '000999'), 0, 'dry run changes nothing');
select is(pg_temp.audits('members.import'), 0, 'dry run writes no audit');

select is(
  public.import_members('[
    {"member_no":"000123","full_name":"สมชาย ใจดี","department":"สสจ.มุกดาหาร","member_type":"ordinary"},
    {"member_no":"001234","full_name":"สมหญิง  รักงาน (ย้าย)","department":"รพ.ใหม่","member_type":"ordinary"},
    {"member_no":"000999","full_name":"สมาชิก ใหม่","member_type":"associate"}
  ]', false) ->> 'inserted',
  '1', 'import commits'
);
select results_eq(
  $$select member_no, full_name, member_type::text, is_active from public.members where member_no in ('000999', '001234') order by 1$$,
  $$values ('000999', 'สมาชิก ใหม่', 'associate', true), ('001234', 'สมหญิง รักงาน (ย้าย)', 'ordinary', true)$$,
  'new member keeps leading zeros; update normalizes whitespace'
);
select is(pg_temp.audits('members.import'), 1, 'import is audited');

select is(
  public.import_members('[
    {"member_no":"","full_name":"x","member_type":"ordinary"},
    {"member_no":"555","full_name":"a","member_type":"ordinary"},
    {"member_no":"555","full_name":"b","member_type":"ordinary"},
    {"member_no":"556","full_name":" ","member_type":"ordinary"},
    {"member_no":"557","full_name":"c","member_type":"vip"}
  ]', false) -> 'errors',
  '[{"row":1,"member_no":"","code":"member_no_required"},
    {"row":2,"member_no":"555","code":"duplicate_in_file"},
    {"row":3,"member_no":"555","code":"duplicate_in_file"},
    {"row":4,"member_no":"556","code":"full_name_required"},
    {"row":5,"member_no":"557","code":"member_type_invalid"}]'::jsonb,
  'invalid rows are reported with row numbers'
);
select is((select count(*)::int from public.members where member_no like '55_'), 0, 'invalid import is all-or-nothing');
select is(public.import_members('[]', false) ->> 'code', 'empty_file', 'empty import is rejected');

select is(
  public.set_member_active((select id from public.members where member_no = '100001'), false) ->> 'ok',
  'true', 'admin can deactivate a member'
);
select is(pg_temp.audits('member.deactivate'), 1, 'member deactivation is audited');

-- Event lifecycle & eligibility -----------------------------------------------
create temp table new_event as
  select (public.save_event(null, 'ประชุมใหญ่ 2570', '2027-12-19') ->> 'event_id')::uuid as id;
select is((select status::text from public.events where id = (select id from new_event)), 'draft', 'new event starts as draft');
select is(public.set_event_status((select id from new_event), 'open') ->> 'code', 'no_eligible_members',
  'cannot open an event without eligible members');

select is(
  (public.generate_eligibility((select id from new_event), false) ->> 'count')::int,
  (select count(*)::int from public.members where is_active and member_type = 'ordinary'),
  'eligibility = active ordinary members when associates are excluded'
);
select is(
  (public.generate_eligibility((select id from new_event)) ->> 'count')::int,
  (select count(*)::int from public.members where is_active),
  'regenerating replaces the snapshot with all active members'
);
select is(
  public.set_event_status((select id from new_event), 'open') ->> 'code', 'another_event_open',
  'only one event can be open'
);
select is(public.set_event_status('30000000-0000-0000-0000-000000000001', 'draft') ->> 'code', 'invalid_transition',
  'open -> draft is not allowed');
select is(public.set_event_status('30000000-0000-0000-0000-000000000001', 'closed') ->> 'ok', 'true', 'admin closes the event');
select is(public.set_event_status((select id from new_event), 'open') ->> 'ok', 'true', 'next event opens after the first closes');
select is(public.generate_eligibility((select id from new_event)) ->> 'code', 'event_not_draft',
  'eligibility snapshot is frozen once open');
select is(
  public.set_member_eligibility((select id from new_event), (select id from public.members where member_no = '100001'), false) ->> 'code',
  'event_not_draft', 'members cannot be removed from an open event'
);
select is(
  public.set_member_eligibility((select id from new_event), (select id from public.members where member_no = '100002'), true) ->> 'ok',
  'true', 'a late member can be added to an open event'
);
select is(pg_temp.audits('event.status'), 2, 'status changes are audited');

-- Stations & assignments --------------------------------------------------------
select is(public.save_station(null, 'S01', 'ซ้ำ', true) ->> 'code', 'duplicate_code', 'station codes are unique');
create temp table new_station as select (public.save_station(null, 'S09', 'จุดสำรอง', true) ->> 'station_id')::uuid as id;
select is(
  public.assign_station((select id from new_event), '10000000-0000-0000-0000-000000000003', (select id from new_station)) ->> 'ok',
  'true', 'admin assigns a station'
);
select is(
  public.assign_station((select id from new_event), '10000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000002') ->> 'ok',
  'true', 'reassigning moves the staff member'
);
select is(
  (select count(*)::int from public.staff_station_assignments
    where event_id = (select id from new_event) and staff_id = '10000000-0000-0000-0000-000000000003' and is_active),
  1, 'exactly one active assignment remains'
);
select is(
  public.assign_station((select id from new_event), '10000000-0000-0000-0000-000000000002', (select id from new_station)) ->> 'code',
  'role_cannot_check_in', 'supervisors cannot be assigned a station'
);

-- Staff profiles ------------------------------------------------------------------
select is(
  public.update_staff('10000000-0000-0000-0000-000000000001', 'ผู้ดูแลระบบ ทดสอบ', 'staff', true) ->> 'code',
  'cannot_modify_self', 'admin cannot demote themselves'
);
select is(
  public.update_staff('10000000-0000-0000-0000-000000000004', 'เจ้าหน้าที่ จุด 2', 'staff', false) ->> 'ok',
  'true', 'admin deactivates a staff account'
);
select ok((select count(*) from public.list_staff()) >= 10, 'admin lists staff with e-mail');

-- Cancellation / reactivation ---------------------------------------------------------
select pg_temp.act_as('10000000-0000-0000-0000-000000000003');
create temp table reg as
  select (public.register_member((select id from new_event), (select id from public.members where member_no = '000123'))
    -> 'checkin' ->> 'id')::uuid as id;
select pg_temp.act_as('10000000-0000-0000-0000-000000000001');

select is(public.cancel_checkin((select id from reg), '  ') ->> 'code', 'reason_required', 'cancellation requires a reason');
select is(public.cancel_checkin((select id from reg), 'ลงทะเบียนผิดคน') ->> 'ok', 'true', 'admin cancels a check-in');
select is(public.cancel_checkin((select id from reg), 'ซ้ำ') ->> 'code', 'not_active', 'cannot cancel twice');
select is(
  (public.get_dashboard_stats((select id from new_event)) ->> 'registered')::int, 0,
  'cancelled check-in leaves the totals'
);
select is(public.reactivate_checkin((select id from reg), 'ยืนยันตัวตนแล้ว') ->> 'ok', 'true', 'admin reactivates the same row');
select results_eq(
  $$select status::text, cancel_reason, (select count(*)::int from public.checkins c2
      where c2.event_id = c.event_id and c2.member_id = c.member_id)
    from public.checkins c where id = (select id from reg)$$,
  $$values ('active', null::text, 1)$$,
  'reactivation reuses the single row (UNIQUE preserved)'
);
reset role;
select results_eq(
  $$select action, details ->> 'reason' from public.audit_logs
    where action in ('checkin.cancel', 'checkin.reactivate') order by created_at, action$$,
  $$values ('checkin.cancel', 'ลงทะเบียนผิดคน'), ('checkin.reactivate', 'ยืนยันตัวตนแล้ว')$$,
  'cancel and reactivate are both in the audit trail with reasons'
);
select is(
  (select details ->> 'previous_cancel_reason' from public.audit_logs where action = 'checkin.reactivate'),
  'ลงทะเบียนผิดคน', 'reactivation audit keeps the previous cancellation'
);
select throws_ok($$delete from public.audit_logs$$, '42501', null, 'audit trail cannot be deleted');

select * from finish();
rollback;
