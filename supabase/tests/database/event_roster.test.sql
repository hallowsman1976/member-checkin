-- Run with `npm run db:test` (local Supabase, seed applied).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Assigned station/payout order on the seeded open event (set as owner, before switching role).
update public.event_members set station_id = '20000000-0000-0000-0000-000000000002', payout_seq = 5
where event_id = '30000000-0000-0000-0000-000000000001'
  and member_id = (select id from public.members where member_no = '000123');

set local role authenticated;

-- Permissions & event state ----------------------------------------------------
select pg_temp.act_as('10000000-0000-0000-0000-000000000002'); -- supervisor
select throws_ok($$select public.import_event_roster('30000000-0000-0000-0000-000000000001',
  '[{"member_no":"1","full_name":"x","member_type":"ordinary"}]', true)$$,
  '42501', null, 'supervisor cannot import a roster');

select pg_temp.act_as('10000000-0000-0000-0000-000000000001'); -- admin
select is(
  public.import_event_roster('30000000-0000-0000-0000-000000000001',
    '[{"member_no":"1","full_name":"x","member_type":"ordinary"}]', true) ->> 'code',
  'event_not_draft', 'an open event keeps its eligibility');

create temp table draft as
select (public.save_event(null, 'ประชุมใหญ่ ทดสอบรายชื่อ', '2027-12-20') ->> 'event_id')::uuid as id;

-- Validation -------------------------------------------------------------------
select is(
  (select jsonb_agg(e ->> 'code' order by (e ->> 'row')::int) from jsonb_array_elements(
    public.import_event_roster((select id from draft), '[
      {"member_no":"700001","full_name":"ก","member_type":"ordinary","station_code":"S99","payout_seq":"1"},
      {"member_no":"700002","full_name":"ข","member_type":"ordinary","station_code":"S01","payout_seq":"x"},
      {"member_no":"700003","full_name":"ค","member_type":"ordinary","station_code":"S01","payout_seq":"2"},
      {"member_no":"700004","full_name":"ง","member_type":"ordinary","station_code":"S01","payout_seq":"2"}
    ]', true) -> 'errors') e),
  '["station_not_found", "payout_seq_invalid", "duplicate_payout_seq", "duplicate_payout_seq"]'::jsonb,
  'unknown station, bad order and duplicate order within a station are rejected'
);

-- Dry run ----------------------------------------------------------------------
create temp table roster_payload as select '[
  {"member_no":"000123","full_name":"สมชาย ใจดี","department":"สสจ.มุกดาหาร","member_type":"ordinary","member_unit":"สสจ.มุกดาหาร","station_code":"S01","payout_seq":"1"},
  {"member_no":"700010","full_name":"นางสาวทดสอบ หนึ่ง","department":"รพ.ดงหลวง","member_type":"ordinary","member_unit":"อ.ดงหลวง","station_code":"S02","payout_seq":"1"},
  {"member_no":"700011","full_name":"นายทดสอบ สอง","department":"รพ.ดงหลวง","member_type":"ordinary","member_unit":"อ.ดงหลวง","station_code":"S02","payout_seq":2}
]'::jsonb as rows;

select is(
  public.import_event_roster((select id from draft), (select rows from roster_payload), true)
    - 'by_station' - 'previous_eligible',
  '{"ok": true, "dry_run": true, "inserted": 2, "updated": 1, "unchanged": 0, "eligible": 3}'::jsonb,
  'dry run counts member changes and the new eligibility'
);
select is((select count(*)::int from public.members where member_no like '7000%'), 0, 'dry run changes nothing');

-- Commit -----------------------------------------------------------------------
select is(
  public.import_event_roster((select id from draft), (select rows from roster_payload), false) ->> 'ok',
  'true', 'roster import commits'
);
select is((select count(*)::int from public.event_members where event_id = (select id from draft)), 3,
  'eligibility equals the file');
select results_eq(
  $$select s.station_code, em.payout_seq from public.event_members em
    join public.members m on m.id = em.member_id join public.stations s on s.id = em.station_id
    where em.event_id = (select id from draft) order by m.member_no$$,
  $$values ('S01', 1), ('S02', 1), ('S02', 2)$$,
  'assigned station and payout order are stored per event'
);
select is((select member_unit from public.members where member_no = '700010'), 'อ.ดงหลวง', 'member unit is stored');
select is(
  (select event_id from public.audit_logs where action = 'eligibility.import_roster' order by created_at desc limit 1),
  (select id from draft), 'roster import is audited'
);
select is(
  (select station_id from public.event_members where event_id = '30000000-0000-0000-0000-000000000001'
     and member_id = (select id from public.members where member_no = '000123')),
  '20000000-0000-0000-0000-000000000002'::uuid, 'another event keeps its own assignment'
);

-- Re-import replaces the snapshot
select is(
  (public.import_event_roster((select id from draft),
    '[{"member_no":"700010","full_name":"นางสาวทดสอบ หนึ่ง","member_type":"ordinary","station_code":"S03","payout_seq":"9"}]',
    false) ->> 'previous_eligible')::int,
  3, 're-import reports the previous size'
);
select is((select count(*)::int from public.event_members where event_id = (select id from draft)), 1,
  're-import replaces the eligibility snapshot');

-- Search & reports on the open event --------------------------------------------
select pg_temp.act_as('10000000-0000-0000-0000-000000000003'); -- staff1 (S01)
select results_eq(
  $$select assigned_station_code, payout_seq from public.search_members('000123')$$,
  $$values ('S02'::text, 5)$$,
  'search shows the assigned station and payout order'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000002'); -- supervisor
select is(
  (public.get_report('30000000-0000-0000-0000-000000000001', 'payout', '20000000-0000-0000-0000-000000000002')
    -> 'rows' -> 0 ->> 'member_no'),
  '000123', 'payout report filters by assigned station'
);
select is(
  (select count(*)::int from public.export_report('30000000-0000-0000-0000-000000000001', 'xlsx', 'payout')),
  (select count(*)::int from public.event_members where event_id = '30000000-0000-0000-0000-000000000001'),
  'payout export lists every eligible member'
);
select ok(
  (public.get_dashboard_stats('30000000-0000-0000-0000-000000000001') -> 'by_member_unit') is not null,
  'dashboard reports totals by member unit'
);

select * from finish();
rollback;
