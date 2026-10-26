-- Check-in order number per event (ลำดับที่), e.g. for a gift to the first 100.
-- Assigned once at insert; cancellation/reactivation keep the same row and number.

alter table public.checkins add column checkin_no integer;

update public.checkins c
set checkin_no = n.rn
from (
  select id, row_number() over (partition by event_id order by checked_in_at, id) as rn
  from public.checkins
) n
where n.id = c.id;

alter table public.checkins
  alter column checkin_no set not null,
  add constraint checkins_event_checkin_no_key unique (event_id, checkin_no);

-- A per-event transaction lock serializes numbering so concurrent stations never
-- share a number. Fires before the ON CONFLICT check; a skipped insert uses no number.
create function private.assign_checkin_no()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('checkin_no:' || new.event_id::text, 0));
  select coalesce(max(checkin_no), 0) + 1 into new.checkin_no
  from public.checkins where event_id = new.event_id;
  return new;
end;
$$;
revoke all on function private.assign_checkin_no() from public;

create trigger checkins_assign_checkin_no
  before insert on public.checkins
  for each row execute function private.assign_checkin_no();

create or replace function private.checkin_json(p_event_id uuid, p_member_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'checkin_no', c.checkin_no,
    'status', c.status,
    'checked_in_at', c.checked_in_at,
    'staff_id', c.staff_id,
    'staff_name', sp.full_name,
    'station_id', c.station_id,
    'station_code', s.station_code,
    'station_name', s.station_name
  )
  from public.checkins c
  join public.stations s on s.id = c.station_id
  join public.staff_profiles sp on sp.id = c.staff_id
  where c.event_id = p_event_id and c.member_id = p_member_id;
$$;

create or replace function public.list_checkins(
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
        'id', f.id, 'checkin_no', f.checkin_no, 'member_no', f.member_no, 'full_name', f.full_name, 'department', f.department,
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
