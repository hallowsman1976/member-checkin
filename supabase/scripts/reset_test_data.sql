-- One-time cleanup of TEST data before importing the real member list (Import_member69.xlsx).
-- NOT a migration. Run once by an admin in the Supabase SQL Editor (runs as postgres).
--
-- Deletes: all check-ins, all event eligibility rows and all members.
-- Keeps:   events (every event is set back to 'draft'), stations, staff accounts,
--          station assignments and the append-only audit log (a 'test_data.reset'
--          entry is added).
--
-- Never run this after real check-ins exist: history must be preserved from then on.
-- To run: change v_confirm below to 'ล้างข้อมูลทดสอบ' and execute the whole script.

do $$
declare
  v_confirm constant text := 'CHANGE_ME';
  v_checkins int;
  v_event_members int;
  v_members int;
  v_events int;
begin
  if v_confirm <> 'ล้างข้อมูลทดสอบ' then
    raise exception 'ยังไม่ได้ยืนยัน: แก้ v_confirm เป็น ''ล้างข้อมูลทดสอบ'' ก่อนรัน';
  end if;

  -- Order follows the foreign keys: checkins -> event_members -> members.
  delete from public.checkins;
  get diagnostics v_checkins = row_count;
  delete from public.event_members;
  get diagnostics v_event_members = row_count;
  delete from public.members;
  get diagnostics v_members = row_count;
  update public.events set status = 'draft' where status <> 'draft';
  get diagnostics v_events = row_count;

  perform private.write_audit(null, 'test_data.reset', jsonb_build_object(
    'checkins', v_checkins, 'event_members', v_event_members, 'members', v_members,
    'events_set_draft', v_events
  ));

  raise notice 'ลบ check-ins % รายการ, สิทธิ์ % รายการ, สมาชิก % คน; ตั้งกิจกรรมกลับเป็นร่าง % รายการ',
    v_checkins, v_event_members, v_members, v_events;
end;
$$;
