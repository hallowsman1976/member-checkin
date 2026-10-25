-- Phase 3: authoritative dashboard aggregates, scoped history, reports, audited exports, Realtime.

-- Realtime only signals "something changed"; clients refetch the aggregates below.
-- postgres_changes respects RLS, so only roles that can SELECT a row receive its event.
alter publication supabase_realtime add table public.checkins;

-- ---------------------------------------------------------------------------
-- Dashboard (admin/supervisor). "Eligible" always means a row in event_members.
-- ---------------------------------------------------------------------------

create function public.get_dashboard_stats(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_eligible int;
  v_registered int;
  v_cancelled int;
begin
  if not private.has_role('admin', 'supervisor') then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_eligible from public.event_members where event_id = p_event_id;
  select count(*) filter (where status = 'active'), count(*) filter (where status = 'cancelled')
    into v_registered, v_cancelled
  from public.checkins where event_id = p_event_id;

  return jsonb_build_object(
    'as_of', now(),
    'eligible', v_eligible,
    'registered', v_registered,
    'remaining', v_eligible - v_registered,
    'cancelled', v_cancelled,
    'by_station', coalesce((
      select jsonb_agg(jsonb_build_object(
        'station_id', s.id, 'station_code', s.station_code, 'station_name', s.station_name,
        'registered', coalesce(c.n, 0)
      ) order by s.station_code)
      from public.stations s
      left join (
        select station_id, count(*) as n from public.checkins
        where event_id = p_event_id and status = 'active' group by station_id
      ) c on c.station_id = s.id
      where s.is_active or c.n > 0
    ), '[]'::jsonb),
    'by_member_type', coalesce((
      select jsonb_agg(jsonb_build_object('member_type', t.member_type, 'eligible', t.eligible, 'registered', t.registered)
        order by t.member_type)
      from (
        select m.member_type, count(*) as eligible, count(c.id) filter (where c.status = 'active') as registered
        from public.event_members em
        join public.members m on m.id = em.member_id
        left join public.checkins c on c.event_id = em.event_id and c.member_id = em.member_id
        where em.event_id = p_event_id
        group by m.member_type
      ) t
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(r order by r.checked_in_at desc)
      from (
        select m.member_no, m.full_name, s.station_code, c.checked_in_at
        from public.checkins c
        join public.members m on m.id = c.member_id
        join public.stations s on s.id = c.station_id
        where c.event_id = p_event_id and c.status = 'active'
        order by c.checked_in_at desc
        limit 10
      ) r
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_dashboard_stats(uuid) from public, anon;
grant execute on function public.get_dashboard_stats(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- History: check-in rows. Staff see only their own check-ins in the open event;
-- admin/supervisor see every check-in of any event.
-- ---------------------------------------------------------------------------

create function public.list_checkins(
  p_event_id uuid,
  p_station_id uuid default null,
  p_member_type public.member_type default null,
  p_status public.checkin_status default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.staff_role := private.current_staff_role();
  v_staff_only uuid;
  v_result jsonb;
begin
  if v_role is null then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  if v_role = 'staff' then
    if not exists (select 1 from public.events where id = p_event_id and status = 'open') then
      return jsonb_build_object('total', 0, 'rows', '[]'::jsonb);
    end if;
    v_staff_only := auth.uid();
  end if;

  with filtered as (
    select c.*, m.member_no, m.full_name, m.department, m.member_type,
      s.station_code, s.station_name, sp.full_name as staff_name
    from public.checkins c
    join public.members m on m.id = c.member_id
    join public.stations s on s.id = c.station_id
    join public.staff_profiles sp on sp.id = c.staff_id
    where c.event_id = p_event_id
      and (v_staff_only is null or c.staff_id = v_staff_only)
      and (p_station_id is null or c.station_id = p_station_id)
      and (p_member_type is null or m.member_type = p_member_type)
      and (p_status is null or c.status = p_status)
      and (p_from is null or c.checked_in_at >= p_from)
      and (p_to is null or c.checked_in_at < p_to)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'member_no', f.member_no, 'full_name', f.full_name, 'department', f.department,
        'member_type', f.member_type, 'status', f.status, 'checked_in_at', f.checked_in_at,
        'station_code', f.station_code, 'station_name', f.station_name, 'staff_name', f.staff_name,
        'cancel_reason', f.cancel_reason, 'cancelled_at', f.cancelled_at
      ) order by f.checked_in_at desc)
      from (
        select * from filtered order by checked_in_at desc
        limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
      ) f
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.list_checkins(uuid, uuid, public.member_type, public.checkin_status, timestamptz, timestamptz, int, int)
  from public, anon;
grant execute on function public.list_checkins(uuid, uuid, public.member_type, public.checkin_status, timestamptz, timestamptz, int, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Reports: eligible members with their status. Station/time filters narrow the
-- registered set; "unregistered" = eligible without an active check-in.
-- ---------------------------------------------------------------------------

create function private.report_rows(
  p_event_id uuid,
  p_filter text,
  p_station_id uuid,
  p_member_type public.member_type,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  member_no text,
  full_name text,
  department text,
  member_type public.member_type,
  is_registered boolean,
  checkin_status public.checkin_status,
  checked_in_at timestamptz,
  station_code text,
  station_name text,
  staff_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.member_no, m.full_name, m.department, m.member_type,
    coalesce(c.status = 'active', false), c.status, c.checked_in_at, s.station_code, s.station_name, sp.full_name
  from public.event_members em
  join public.members m on m.id = em.member_id
  left join public.checkins c on c.event_id = em.event_id and c.member_id = em.member_id
  left join public.stations s on s.id = c.station_id
  left join public.staff_profiles sp on sp.id = c.staff_id
  where em.event_id = p_event_id
    and (p_member_type is null or m.member_type = p_member_type)
    and case p_filter
      when 'registered' then c.status = 'active'
        and (p_station_id is null or c.station_id = p_station_id)
        and (p_from is null or c.checked_in_at >= p_from)
        and (p_to is null or c.checked_in_at < p_to)
      when 'unregistered' then c.status is distinct from 'active'
      else true
    end
  order by m.member_no;
$$;
revoke all on function private.report_rows(uuid, text, uuid, public.member_type, timestamptz, timestamptz) from public;

create function public.get_report(
  p_event_id uuid,
  p_filter text default 'all',
  p_station_id uuid default null,
  p_member_type public.member_type default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 100,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.has_role('admin', 'supervisor') then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  if p_filter not in ('all', 'registered', 'unregistered') then
    raise exception 'invalid filter' using errcode = 'invalid_parameter_value';
  end if;

  with r as (
    select * from private.report_rows(p_event_id, p_filter, p_station_id, p_member_type, p_from, p_to)
  )
  select jsonb_build_object(
    'total', (select count(*) from r),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.member_no)
      from (select * from r order by member_no limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)) p
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_report(uuid, text, uuid, public.member_type, timestamptz, timestamptz, int, int)
  from public, anon;
grant execute on function public.get_report(uuid, text, uuid, public.member_type, timestamptz, timestamptz, int, int)
  to authenticated;

-- Export: the only way to fetch full report rows; every call is written to audit_logs
-- in the same transaction (PDPA).
create function public.export_report(
  p_event_id uuid,
  p_format text,
  p_filter text default 'all',
  p_station_id uuid default null,
  p_member_type public.member_type default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  member_no text,
  full_name text,
  department text,
  member_type public.member_type,
  is_registered boolean,
  checkin_status public.checkin_status,
  checked_in_at timestamptz,
  station_code text,
  station_name text,
  staff_name text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if not private.has_role('admin', 'supervisor') then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  if p_filter not in ('all', 'registered', 'unregistered') or p_format not in ('xlsx', 'csv') then
    raise exception 'invalid parameter' using errcode = 'invalid_parameter_value';
  end if;

  return query
    select * from private.report_rows(p_event_id, p_filter, p_station_id, p_member_type, p_from, p_to);
  get diagnostics v_count = row_count;

  perform private.write_audit(p_event_id, 'report.export', jsonb_build_object(
    'format', p_format, 'filter', p_filter, 'station_id', p_station_id, 'member_type', p_member_type,
    'from', p_from, 'to', p_to, 'row_count', v_count
  ));
end;
$$;
revoke all on function public.export_report(uuid, text, text, uuid, public.member_type, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.export_report(uuid, text, text, uuid, public.member_type, timestamptz, timestamptz)
  to authenticated;
