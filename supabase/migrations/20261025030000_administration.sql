-- Phase 4: admin-only mutations. Every function checks the caller server-side,
-- returns {"ok": true, ...} or {"ok": false, "code": "..."} for expected failures,
-- and appends an audit entry for every change it commits.

create function private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role('admin') then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function private.require_admin() from public;

create function private.fail(p_code text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('ok', false, 'code', p_code);
$$;
revoke all on function private.fail(text) from public;

-- ---------------------------------------------------------------------------
-- Member import: all-or-nothing upsert by member_no. p_dry_run = true is the
-- server-side preview (validates and counts, changes nothing, no audit).
-- Input: [{member_no, full_name, department?, member_type, is_active?}, ...]
-- ---------------------------------------------------------------------------

-- Normalized import rows (row_no is 1-based position in the payload).
create function private.import_rows(p_rows jsonb)
returns table (row_no int, member_no text, full_name text, department text, member_type text, is_active boolean)
language sql
immutable
set search_path = ''
as $$
  select
    e.ord::int,
    btrim(e.value ->> 'member_no'),
    regexp_replace(btrim(coalesce(e.value ->> 'full_name', '')), '\s+', ' ', 'g'),
    nullif(btrim(coalesce(e.value ->> 'department', '')), ''),
    btrim(coalesce(e.value ->> 'member_type', '')),
    case when e.value ? 'is_active' and jsonb_typeof(e.value -> 'is_active') = 'boolean'
      then (e.value ->> 'is_active')::boolean end
  from jsonb_array_elements(p_rows) with ordinality as e(value, ord);
$$;
revoke all on function private.import_rows(jsonb) from public;

create function public.import_members(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_errors jsonb;
  v_inserted int;
  v_updated int;
  v_unchanged int;
begin
  perform private.require_admin();

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return private.fail('empty_file');
  end if;
  if jsonb_array_length(p_rows) > 10000 then
    return private.fail('too_many_rows');
  end if;

  select jsonb_agg(jsonb_build_object('row', row_no, 'member_no', member_no, 'code', code) order by row_no)
  into v_errors
  from (
    select i.row_no, i.member_no,
      case
        when coalesce(i.member_no, '') = '' then 'member_no_required'
        when i.member_no ~ '\s' then 'member_no_invalid'
        when count(*) over (partition by i.member_no) > 1 then 'duplicate_in_file'
        when i.full_name = '' then 'full_name_required'
        when i.member_type not in ('ordinary', 'associate') then 'member_type_invalid'
      end as code
    from private.import_rows(p_rows) i
  ) v
  where code is not null;

  if v_errors is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_rows', 'errors', v_errors);
  end if;

  select
    count(*) filter (where m.id is null),
    count(*) filter (where m.id is not null and (m.full_name, m.department, m.member_type::text, m.is_active)
      is distinct from (i.full_name, i.department, i.member_type, coalesce(i.is_active, m.is_active))),
    count(*) filter (where m.id is not null and (m.full_name, m.department, m.member_type::text, m.is_active)
      is not distinct from (i.full_name, i.department, i.member_type, coalesce(i.is_active, m.is_active)))
  into v_inserted, v_updated, v_unchanged
  from private.import_rows(p_rows) i
  left join public.members m on m.member_no = i.member_no;

  if not p_dry_run then
    update public.members m set
      full_name = i.full_name,
      department = i.department,
      member_type = i.member_type::public.member_type,
      is_active = coalesce(i.is_active, m.is_active)
    from private.import_rows(p_rows) i
    where m.member_no = i.member_no
      and (m.full_name, m.department, m.member_type::text, m.is_active)
        is distinct from (i.full_name, i.department, i.member_type, coalesce(i.is_active, m.is_active));

    insert into public.members (member_no, full_name, department, member_type, is_active)
    select i.member_no, i.full_name, i.department, i.member_type::public.member_type, coalesce(i.is_active, true)
    from private.import_rows(p_rows) i
    where not exists (select 1 from public.members m where m.member_no = i.member_no);

    perform private.write_audit(null, 'members.import', jsonb_build_object(
      'rows', jsonb_array_length(p_rows), 'inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged
    ));
  end if;

  return jsonb_build_object('ok', true, 'dry_run', p_dry_run,
    'inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged);
end;
$$;

create function public.set_member_active(p_member_id uuid, p_is_active boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member_no text;
begin
  perform private.require_admin();
  update public.members set is_active = p_is_active
  where id = p_member_id and is_active is distinct from p_is_active
  returning member_no into v_member_no;
  if not found then
    return private.fail(case when exists (select 1 from public.members where id = p_member_id)
      then 'unchanged' else 'member_not_found' end);
  end if;
  perform private.write_audit(null, case when p_is_active then 'member.activate' else 'member.deactivate' end,
    jsonb_build_object('member_id', p_member_id, 'member_no', v_member_no));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Events & lifecycle: draft -> open -> closed (-> open again if reopened).
-- ---------------------------------------------------------------------------

create function public.save_event(p_event_id uuid, p_title text, p_event_date date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_admin();
  if btrim(coalesce(p_title, '')) = '' or p_event_date is null then
    return private.fail('invalid_input');
  end if;

  if p_event_id is null then
    insert into public.events (title, event_date) values (btrim(p_title), p_event_date) returning id into v_id;
    perform private.write_audit(v_id, 'event.create', jsonb_build_object('title', btrim(p_title), 'event_date', p_event_date));
  else
    update public.events set title = btrim(p_title), event_date = p_event_date
    where id = p_event_id returning id into v_id;
    if not found then
      return private.fail('event_not_found');
    end if;
    perform private.write_audit(v_id, 'event.update', jsonb_build_object('title', btrim(p_title), 'event_date', p_event_date));
  end if;
  return jsonb_build_object('ok', true, 'event_id', v_id);
end;
$$;

create function public.set_event_status(p_event_id uuid, p_status public.event_status)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_current public.event_status;
begin
  perform private.require_admin();

  -- FOR UPDATE waits for in-flight register_member calls (they hold FOR SHARE),
  -- so no registration commits against an event after it is closed.
  select status into v_current from public.events where id = p_event_id for update;
  if not found then
    return private.fail('event_not_found');
  end if;
  if not (
    (v_current = 'draft' and p_status = 'open')
    or (v_current = 'open' and p_status = 'closed')
    or (v_current = 'closed' and p_status = 'open')
  ) then
    return private.fail('invalid_transition');
  end if;
  if p_status = 'open' and not exists (select 1 from public.event_members where event_id = p_event_id) then
    return private.fail('no_eligible_members');
  end if;

  begin
    update public.events set status = p_status where id = p_event_id;
  exception when unique_violation then
    return private.fail('another_event_open');
  end;

  perform private.write_audit(p_event_id, 'event.status', jsonb_build_object('from', v_current, 'to', p_status));
  return jsonb_build_object('ok', true);
end;
$$;

-- Replaces the eligibility snapshot (draft only).
create function public.generate_eligibility(p_event_id uuid, p_include_associate boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status public.event_status;
  v_count int;
begin
  perform private.require_admin();
  select status into v_status from public.events where id = p_event_id for update;
  if not found then
    return private.fail('event_not_found');
  end if;
  if v_status <> 'draft' then
    return private.fail('event_not_draft');
  end if;

  delete from public.event_members where event_id = p_event_id;
  insert into public.event_members (event_id, member_id)
  select p_event_id, m.id from public.members m
  where m.is_active and (p_include_associate or m.member_type = 'ordinary');
  get diagnostics v_count = row_count;

  perform private.write_audit(p_event_id, 'eligibility.generate',
    jsonb_build_object('include_associate', p_include_associate, 'count', v_count));
  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

-- Adding is allowed while draft or open (late-joining members); removing only while draft.
create function public.set_member_eligibility(p_event_id uuid, p_member_id uuid, p_eligible boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status public.event_status;
  v_member_no text;
begin
  perform private.require_admin();
  select status into v_status from public.events where id = p_event_id for update;
  if not found then
    return private.fail('event_not_found');
  end if;
  select member_no into v_member_no from public.members where id = p_member_id;
  if not found then
    return private.fail('member_not_found');
  end if;

  if p_eligible then
    if v_status = 'closed' then
      return private.fail('event_closed');
    end if;
    insert into public.event_members (event_id, member_id) values (p_event_id, p_member_id)
    on conflict do nothing;
    if not found then
      return private.fail('unchanged');
    end if;
  else
    if v_status <> 'draft' then
      return private.fail('event_not_draft');
    end if;
    delete from public.event_members where event_id = p_event_id and member_id = p_member_id;
    if not found then
      return private.fail('unchanged');
    end if;
  end if;

  perform private.write_audit(p_event_id, case when p_eligible then 'eligibility.add' else 'eligibility.remove' end,
    jsonb_build_object('member_id', p_member_id, 'member_no', v_member_no));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Stations, staff profiles, assignments
-- ---------------------------------------------------------------------------

create function public.save_station(p_station_id uuid, p_station_code text, p_station_name text, p_is_active boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_admin();
  if btrim(coalesce(p_station_code, '')) = '' or btrim(coalesce(p_station_name, '')) = '' then
    return private.fail('invalid_input');
  end if;

  begin
    if p_station_id is null then
      insert into public.stations (station_code, station_name, is_active)
      values (btrim(p_station_code), btrim(p_station_name), coalesce(p_is_active, true))
      returning id into v_id;
    else
      update public.stations
      set station_code = btrim(p_station_code), station_name = btrim(p_station_name), is_active = coalesce(p_is_active, is_active)
      where id = p_station_id returning id into v_id;
      if not found then
        return private.fail('station_not_found');
      end if;
    end if;
  exception when unique_violation then
    return private.fail('duplicate_code');
  end;

  perform private.write_audit(null, case when p_station_id is null then 'station.create' else 'station.update' end,
    jsonb_build_object('station_id', v_id, 'station_code', btrim(p_station_code),
      'station_name', btrim(p_station_name), 'is_active', p_is_active));
  return jsonb_build_object('ok', true, 'station_id', v_id);
end;
$$;

-- Staff list with login e-mail (auth.users is not readable by clients).
create function public.list_staff()
returns table (id uuid, email text, full_name text, role public.staff_role, is_active boolean, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select sp.id, u.email::text, sp.full_name, sp.role, sp.is_active, sp.created_at
    from public.staff_profiles sp
    join auth.users u on u.id = sp.id
    order by sp.role, sp.full_name;
end;
$$;

create function public.update_staff(p_staff_id uuid, p_full_name text, p_role public.staff_role, p_is_active boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before public.staff_profiles%rowtype;
begin
  perform private.require_admin();
  if btrim(coalesce(p_full_name, '')) = '' or p_role is null or p_is_active is null then
    return private.fail('invalid_input');
  end if;
  select * into v_before from public.staff_profiles where id = p_staff_id for update;
  if not found then
    return private.fail('staff_not_found');
  end if;
  -- An admin cannot lock themselves out.
  if p_staff_id = auth.uid() and (p_role <> 'admin' or not p_is_active) then
    return private.fail('cannot_modify_self');
  end if;

  update public.staff_profiles
  set full_name = btrim(p_full_name), role = p_role, is_active = p_is_active
  where id = p_staff_id;

  perform private.write_audit(null, 'staff.update', jsonb_build_object(
    'staff_id', p_staff_id,
    'before', jsonb_build_object('full_name', v_before.full_name, 'role', v_before.role, 'is_active', v_before.is_active),
    'after', jsonb_build_object('full_name', btrim(p_full_name), 'role', p_role, 'is_active', p_is_active)
  ));
  return jsonb_build_object('ok', true);
end;
$$;

-- p_station_id = null removes the assignment.
create function public.assign_station(p_event_id uuid, p_staff_id uuid, p_station_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status public.event_status;
  v_role public.staff_role;
  v_previous uuid;
begin
  perform private.require_admin();
  select status into v_status from public.events where id = p_event_id;
  if not found then
    return private.fail('event_not_found');
  end if;
  if v_status = 'closed' then
    return private.fail('event_closed');
  end if;
  select role into v_role from public.staff_profiles where id = p_staff_id and is_active;
  if not found then
    return private.fail('staff_inactive');
  end if;
  if v_role = 'supervisor' then
    return private.fail('role_cannot_check_in');
  end if;
  if p_station_id is not null and not exists (select 1 from public.stations where id = p_station_id and is_active) then
    return private.fail('station_inactive');
  end if;

  update public.staff_station_assignments set is_active = false
  where event_id = p_event_id and staff_id = p_staff_id and is_active
  returning station_id into v_previous;

  if p_station_id is not null then
    insert into public.staff_station_assignments (event_id, staff_id, station_id) values (p_event_id, p_staff_id, p_station_id);
  end if;

  perform private.write_audit(p_event_id, 'assignment.set', jsonb_build_object(
    'staff_id', p_staff_id, 'from_station_id', v_previous, 'to_station_id', p_station_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancellation / reactivation. The row is never deleted, so UNIQUE(event_id,
-- member_id) still holds. Reactivation restores the original check-in
-- (time, station, staff); the audit trail records who changed it and why.
-- ---------------------------------------------------------------------------

create function public.cancel_checkin(p_checkin_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.checkins%rowtype;
begin
  perform private.require_admin();
  if btrim(coalesce(p_reason, '')) = '' then
    return private.fail('reason_required');
  end if;
  select * into v_row from public.checkins where id = p_checkin_id for update;
  if not found then
    return private.fail('checkin_not_found');
  end if;
  if v_row.status <> 'active' then
    return private.fail('not_active');
  end if;

  update public.checkins
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason)
  where id = p_checkin_id;

  perform private.write_audit(v_row.event_id, 'checkin.cancel', jsonb_build_object(
    'checkin_id', v_row.id, 'member_id', v_row.member_id, 'station_id', v_row.station_id,
    'checked_in_at', v_row.checked_in_at, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.reactivate_checkin(p_checkin_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.checkins%rowtype;
begin
  perform private.require_admin();
  if btrim(coalesce(p_reason, '')) = '' then
    return private.fail('reason_required');
  end if;
  select * into v_row from public.checkins where id = p_checkin_id for update;
  if not found then
    return private.fail('checkin_not_found');
  end if;
  if v_row.status <> 'cancelled' then
    return private.fail('not_cancelled');
  end if;
  if not exists (select 1 from public.members where id = v_row.member_id and is_active) then
    return private.fail('member_inactive');
  end if;

  update public.checkins
  set status = 'active', cancelled_at = null, cancelled_by = null, cancel_reason = null
  where id = p_checkin_id;

  perform private.write_audit(v_row.event_id, 'checkin.reactivate', jsonb_build_object(
    'checkin_id', v_row.id, 'member_id', v_row.member_id, 'reason', btrim(p_reason),
    'previous_cancel_reason', v_row.cancel_reason, 'previous_cancelled_at', v_row.cancelled_at,
    'previous_cancelled_by', v_row.cancelled_by));
  return jsonb_build_object('ok', true);
end;
$$;

-- list_checkins rows need the check-in id for these actions (already included).

-- ---------------------------------------------------------------------------
-- Grants: authenticated may call; each function checks admin itself.
-- ---------------------------------------------------------------------------

revoke all on function public.import_members(jsonb, boolean) from public, anon;
revoke all on function public.set_member_active(uuid, boolean) from public, anon;
revoke all on function public.save_event(uuid, text, date) from public, anon;
revoke all on function public.set_event_status(uuid, public.event_status) from public, anon;
revoke all on function public.generate_eligibility(uuid, boolean) from public, anon;
revoke all on function public.set_member_eligibility(uuid, uuid, boolean) from public, anon;
revoke all on function public.save_station(uuid, text, text, boolean) from public, anon;
revoke all on function public.list_staff() from public, anon;
revoke all on function public.update_staff(uuid, text, public.staff_role, boolean) from public, anon;
revoke all on function public.assign_station(uuid, uuid, uuid) from public, anon;
revoke all on function public.cancel_checkin(uuid, text) from public, anon;
revoke all on function public.reactivate_checkin(uuid, text) from public, anon;

grant execute on function public.import_members(jsonb, boolean) to authenticated;
grant execute on function public.set_member_active(uuid, boolean) to authenticated;
grant execute on function public.save_event(uuid, text, date) to authenticated;
grant execute on function public.set_event_status(uuid, public.event_status) to authenticated;
grant execute on function public.generate_eligibility(uuid, boolean) to authenticated;
grant execute on function public.set_member_eligibility(uuid, uuid, boolean) to authenticated;
grant execute on function public.save_station(uuid, text, text, boolean) to authenticated;
grant execute on function public.list_staff() to authenticated;
grant execute on function public.update_staff(uuid, text, public.staff_role, boolean) to authenticated;
grant execute on function public.assign_station(uuid, uuid, uuid) to authenticated;
grant execute on function public.cancel_checkin(uuid, text) to authenticated;
grant execute on function public.reactivate_checkin(uuid, text) to authenticated;
