-- Phase 2: member search, atomic registration, status lookup for unknown outcomes.

-- ---------------------------------------------------------------------------
-- search_members: member no. (exact/prefix, leading zeros kept) or Thai name
-- (partial, whitespace-normalized), scoped to the open event. Max 20 rows.
-- SECURITY INVOKER: RLS already limits rows to active staff.
-- ---------------------------------------------------------------------------

create function public.search_members(p_query text)
returns table (
  id uuid,
  member_no text,
  full_name text,
  department text,
  member_type public.member_type,
  is_active boolean,
  is_eligible boolean,
  checkin_status public.checkin_status,
  checked_in_at timestamptz,
  station_code text,
  station_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g') as text
  ),
  pattern as (
    -- Escape LIKE wildcards so user input is matched literally.
    select q.text, replace(replace(replace(q.text, '\', '\\'), '%', '\%'), '_', '\_') as escaped
    from q
  ),
  open_event as (
    select e.id from public.events e where e.status = 'open'
  ),
  matches as (
    select
      m.*,
      case
        when m.member_no = p.text then 0
        when m.member_no like p.escaped || '%' then 1
        when m.full_name ilike p.escaped || '%' then 2
        else 3
      end as rank
    from public.members m, pattern p
    where p.text <> ''
      and (
        m.member_no like p.escaped || '%'
        or m.full_name ilike '%' || p.escaped || '%'
      )
  )
  select
    m.id, m.member_no, m.full_name, m.department, m.member_type, m.is_active,
    em.member_id is not null as is_eligible,
    c.status, c.checked_in_at, s.station_code, s.station_name
  from matches m
  left join open_event oe on true
  left join public.event_members em on em.event_id = oe.id and em.member_id = m.id
  left join public.checkins c on c.event_id = oe.id and c.member_id = m.id
  left join public.stations s on s.id = c.station_id
  order by m.rank, m.member_no
  limit 20;
$$;
revoke all on function public.search_members(text) from public, anon;
grant execute on function public.search_members(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Shared shape for an existing check-in.
-- ---------------------------------------------------------------------------

create function private.checkin_json(p_event_id uuid, p_member_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
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
revoke all on function private.checkin_json(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- register_member: the only write path into checkins.
-- Returns {"result": "registered" | "already_registered" | "cancelled", "checkin": {...}}
--      or {"result": "error", "code": "<code>"}.
-- ---------------------------------------------------------------------------

create function public.register_member(p_event_id uuid, p_member_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_staff public.staff_profiles%rowtype;
  v_event_status public.event_status;
  v_station_id uuid;
  v_station_active boolean;
  v_member_active boolean;
  v_inserted_id uuid;
  v_existing jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('result', 'error', 'code', 'not_authenticated');
  end if;

  select * into v_staff from public.staff_profiles where id = v_uid;
  if not found or not v_staff.is_active then
    return jsonb_build_object('result', 'error', 'code', 'staff_inactive');
  end if;
  if v_staff.role not in ('staff', 'admin') then
    return jsonb_build_object('result', 'error', 'code', 'forbidden');
  end if;

  -- FOR SHARE blocks a concurrent close (UPDATE) until this transaction ends,
  -- and makes this call wait for an in-flight close.
  select status into v_event_status from public.events where id = p_event_id for share;
  if not found then
    return jsonb_build_object('result', 'error', 'code', 'event_not_found');
  end if;
  if v_event_status <> 'open' then
    return jsonb_build_object('result', 'error', 'code', 'event_not_open');
  end if;

  select a.station_id, s.is_active into v_station_id, v_station_active
  from public.staff_station_assignments a
  join public.stations s on s.id = a.station_id
  where a.event_id = p_event_id and a.staff_id = v_uid and a.is_active;
  if not found then
    return jsonb_build_object('result', 'error', 'code', 'no_station');
  end if;
  if not v_station_active then
    return jsonb_build_object('result', 'error', 'code', 'station_inactive');
  end if;

  select is_active into v_member_active from public.members where id = p_member_id;
  if not found then
    return jsonb_build_object('result', 'error', 'code', 'member_not_found');
  end if;
  if not v_member_active then
    return jsonb_build_object('result', 'error', 'code', 'member_inactive');
  end if;
  if not exists (
    select 1 from public.event_members where event_id = p_event_id and member_id = p_member_id
  ) then
    return jsonb_build_object('result', 'error', 'code', 'member_not_eligible');
  end if;

  insert into public.checkins (event_id, member_id, staff_id, station_id)
  values (p_event_id, p_member_id, v_uid, v_station_id)
  on conflict (event_id, member_id) do nothing
  returning id into v_inserted_id;

  v_existing := private.checkin_json(p_event_id, p_member_id);

  if v_inserted_id is not null then
    return jsonb_build_object('result', 'registered', 'checkin', v_existing);
  end if;
  if v_existing ->> 'status' = 'cancelled' then
    return jsonb_build_object('result', 'cancelled', 'checkin', v_existing);
  end if;
  return jsonb_build_object('result', 'already_registered', 'checkin', v_existing);
end;
$$;
revoke all on function public.register_member(uuid, uuid) from public, anon;
grant execute on function public.register_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_checkin_status: resolves an unknown outcome before any retry.
-- Returns {"result": "not_registered"} or {"result": "active" | "cancelled", "checkin": {...}}.
-- ---------------------------------------------------------------------------

create function public.get_checkin_status(p_event_id uuid, p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_existing jsonb;
begin
  if not private.has_role('admin', 'supervisor', 'staff') then
    return jsonb_build_object('result', 'error', 'code', 'staff_inactive');
  end if;

  v_existing := private.checkin_json(p_event_id, p_member_id);
  if v_existing is null then
    return jsonb_build_object('result', 'not_registered');
  end if;
  return jsonb_build_object('result', v_existing ->> 'status', 'checkin', v_existing);
end;
$$;
revoke all on function public.get_checkin_status(uuid, uuid) from public, anon;
grant execute on function public.get_checkin_status(uuid, uuid) to authenticated;
