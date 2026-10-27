-- Per-event roster from the yearly member file (Import_member69.xlsx):
-- members.member_unit (หน่วยสมาชิก), event_members.station_id (จุดลงทะเบียนที่กำหนด) and
-- event_members.payout_seq (ลำดับในแบบฟอร์มจ่ายค่าตอบแทนร่วมประชุม).
-- The assigned station is guidance only: register_member still records the station that
-- actually registered the member; the UI warns when the two differ.

alter table public.members
  add column member_unit text check (member_unit is null or btrim(member_unit) <> '');

alter table public.event_members
  add column station_id uuid references public.stations (id) on delete restrict,
  add column payout_seq integer check (payout_seq is null or payout_seq > 0),
  add constraint event_members_payout_seq_key unique (event_id, station_id, payout_seq);

create index event_members_station_idx on public.event_members (event_id, station_id);

-- ---------------------------------------------------------------------------
-- import_event_roster: all-or-nothing. Upserts members by member_no, then replaces
-- the eligibility snapshot of a draft event with exactly the file's rows.
-- Input: [{member_no, full_name, department?, member_type, member_unit?, station_code?, payout_seq?}, ...]
-- ---------------------------------------------------------------------------

create function private.roster_rows(p_rows jsonb)
returns table (
  row_no int, member_no text, full_name text, department text, member_type text,
  member_unit text, station_code text, payout_seq_text text
)
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
    nullif(regexp_replace(btrim(coalesce(e.value ->> 'member_unit', '')), '\s+', ' ', 'g'), ''),
    nullif(btrim(coalesce(e.value ->> 'station_code', '')), ''),
    nullif(btrim(coalesce(e.value ->> 'payout_seq', '')), '')
  from jsonb_array_elements(p_rows) with ordinality as e(value, ord);
$$;
revoke all on function private.roster_rows(jsonb) from public;

create function public.import_event_roster(p_event_id uuid, p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status public.event_status;
  v_errors jsonb;
  v_inserted int;
  v_updated int;
  v_unchanged int;
  v_previous int;
  v_by_station jsonb;
begin
  perform private.require_admin();

  select status into v_status from public.events where id = p_event_id for update;
  if not found then
    return private.fail('event_not_found');
  end if;
  if v_status <> 'draft' then
    return private.fail('event_not_draft');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return private.fail('empty_file');
  end if;
  if jsonb_array_length(p_rows) > 10000 then
    return private.fail('too_many_rows');
  end if;

  drop table if exists pg_temp.roster;
  create temp table roster on commit drop as
  select r.*, s.id as station_id, s.is_active as station_active,
    case when r.payout_seq_text ~ '^[0-9]{1,9}$' then r.payout_seq_text::int end as payout_seq
  from private.roster_rows(p_rows) r
  left join public.stations s on s.station_code = r.station_code;

  select jsonb_agg(jsonb_build_object('row', row_no, 'member_no', member_no, 'code', code) order by row_no)
  into v_errors
  from (
    select r.row_no, r.member_no,
      case
        when coalesce(r.member_no, '') = '' then 'member_no_required'
        when r.member_no ~ '\s' then 'member_no_invalid'
        when count(*) over (partition by r.member_no) > 1 then 'duplicate_in_file'
        when r.full_name = '' then 'full_name_required'
        when r.member_type not in ('ordinary', 'associate') then 'member_type_invalid'
        when r.station_code is not null and r.station_id is null then 'station_not_found'
        when r.station_id is not null and not r.station_active then 'station_inactive'
        when r.payout_seq_text is not null and coalesce(r.payout_seq, 0) = 0 then 'payout_seq_invalid'
        when r.payout_seq is not null
          and count(*) over (partition by r.station_code, r.payout_seq) > 1 then 'duplicate_payout_seq'
      end as code
    from pg_temp.roster r
  ) v
  where code is not null;

  if v_errors is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_rows', 'errors', v_errors);
  end if;

  select
    count(*) filter (where m.id is null),
    count(*) filter (where m.id is not null and (m.full_name, m.department, m.member_type::text, m.member_unit)
      is distinct from (r.full_name, r.department, r.member_type, r.member_unit)),
    count(*) filter (where m.id is not null and (m.full_name, m.department, m.member_type::text, m.member_unit)
      is not distinct from (r.full_name, r.department, r.member_type, r.member_unit))
  into v_inserted, v_updated, v_unchanged
  from pg_temp.roster r
  left join public.members m on m.member_no = r.member_no;

  select count(*) into v_previous from public.event_members where event_id = p_event_id;

  select coalesce(jsonb_agg(jsonb_build_object('station_code', station_code, 'count', n) order by station_code), '[]'::jsonb)
  into v_by_station
  from (select station_code, count(*) as n from pg_temp.roster group by station_code) t;

  if not p_dry_run then
    update public.members m set
      full_name = r.full_name,
      department = r.department,
      member_type = r.member_type::public.member_type,
      member_unit = r.member_unit
    from pg_temp.roster r
    where m.member_no = r.member_no
      and (m.full_name, m.department, m.member_type::text, m.member_unit)
        is distinct from (r.full_name, r.department, r.member_type, r.member_unit);

    insert into public.members (member_no, full_name, department, member_type, member_unit)
    select r.member_no, r.full_name, r.department, r.member_type::public.member_type, r.member_unit
    from pg_temp.roster r
    where not exists (select 1 from public.members m where m.member_no = r.member_no);

    -- A draft event has never been open, so it has no check-ins referencing these rows.
    delete from public.event_members where event_id = p_event_id;
    insert into public.event_members (event_id, member_id, station_id, payout_seq)
    select p_event_id, m.id, r.station_id, r.payout_seq
    from pg_temp.roster r
    join public.members m on m.member_no = r.member_no;

    perform private.write_audit(p_event_id, 'eligibility.import_roster', jsonb_build_object(
      'rows', jsonb_array_length(p_rows), 'inserted', v_inserted, 'updated', v_updated,
      'unchanged', v_unchanged, 'previous_eligible', v_previous, 'by_station', v_by_station
    ));
  end if;

  return jsonb_build_object('ok', true, 'dry_run', p_dry_run,
    'inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged,
    'eligible', jsonb_array_length(p_rows), 'previous_eligible', v_previous, 'by_station', v_by_station);
end;
$$;
revoke all on function public.import_event_roster(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_event_roster(uuid, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- search_members: adds the member's unit and assigned station/payout order for the open event.
-- ---------------------------------------------------------------------------

drop function public.search_members(text);
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
  station_name text,
  member_unit text,
  assigned_station_code text,
  assigned_station_name text,
  payout_seq integer
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
    c.status, c.checked_in_at, s.station_code, s.station_name,
    m.member_unit, a.station_code, a.station_name, em.payout_seq
  from matches m
  left join open_event oe on true
  left join public.event_members em on em.event_id = oe.id and em.member_id = m.id
  left join public.stations a on a.id = em.station_id
  left join public.checkins c on c.event_id = oe.id and c.member_id = m.id
  left join public.stations s on s.id = c.station_id
  order by m.rank, m.member_no
  limit 20;
$$;
revoke all on function public.search_members(text) from public, anon;
grant execute on function public.search_members(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reports: adds unit, assigned station and payout order. Filter 'payout' lists every
-- eligible member of an assigned station (p_station_id) in payout-form order.
-- ---------------------------------------------------------------------------

drop function public.export_report(uuid, text, text, uuid, public.member_type, timestamptz, timestamptz);
drop function public.get_report(uuid, text, uuid, public.member_type, timestamptz, timestamptz, int, int);
drop function private.report_rows(uuid, text, uuid, public.member_type, timestamptz, timestamptz);

create function private.report_rows(
  p_event_id uuid,
  p_filter text,
  p_station_id uuid,
  p_member_type public.member_type,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  sort_no bigint,
  member_no text,
  full_name text,
  department text,
  member_type public.member_type,
  member_unit text,
  is_registered boolean,
  checkin_status public.checkin_status,
  checked_in_at timestamptz,
  station_code text,
  station_name text,
  staff_name text,
  assigned_station_code text,
  assigned_station_name text,
  payout_seq integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    row_number() over (order by
      case when p_filter = 'payout' then a.station_code end,
      case when p_filter = 'payout' then em.payout_seq end,
      m.member_no),
    m.member_no, m.full_name, m.department, m.member_type, m.member_unit,
    coalesce(c.status = 'active', false), c.status, c.checked_in_at, s.station_code, s.station_name, sp.full_name,
    a.station_code, a.station_name, em.payout_seq
  from public.event_members em
  join public.members m on m.id = em.member_id
  left join public.stations a on a.id = em.station_id
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
      when 'payout' then p_station_id is null or em.station_id = p_station_id
      else true
    end;
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
  if p_filter not in ('all', 'registered', 'unregistered', 'payout') then
    raise exception 'invalid filter' using errcode = 'invalid_parameter_value';
  end if;

  with r as (
    select * from private.report_rows(p_event_id, p_filter, p_station_id, p_member_type, p_from, p_to)
  )
  select jsonb_build_object(
    'total', (select count(*) from r),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(p) - 'sort_no' order by p.sort_no)
      from (select * from r order by sort_no limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)) p
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
  member_unit text,
  is_registered boolean,
  checkin_status public.checkin_status,
  checked_in_at timestamptz,
  station_code text,
  station_name text,
  staff_name text,
  assigned_station_code text,
  assigned_station_name text,
  payout_seq integer
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
  if p_filter not in ('all', 'registered', 'unregistered', 'payout') or p_format not in ('xlsx', 'csv') then
    raise exception 'invalid parameter' using errcode = 'invalid_parameter_value';
  end if;

  return query
    select r.member_no, r.full_name, r.department, r.member_type, r.member_unit, r.is_registered, r.checkin_status,
      r.checked_in_at, r.station_code, r.station_name, r.staff_name, r.assigned_station_code, r.assigned_station_name,
      r.payout_seq
    from private.report_rows(p_event_id, p_filter, p_station_id, p_member_type, p_from, p_to) r
    order by r.sort_no;
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

-- ---------------------------------------------------------------------------
-- Dashboard: adds eligible/registered per member unit (หน่วยสมาชิก).
-- ---------------------------------------------------------------------------

create or replace function public.get_dashboard_stats(p_event_id uuid)
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
    'by_member_unit', coalesce((
      select jsonb_agg(jsonb_build_object('member_unit', t.member_unit, 'eligible', t.eligible, 'registered', t.registered)
        order by t.member_unit nulls last)
      from (
        select m.member_unit, count(*) as eligible, count(c.id) filter (where c.status = 'active') as registered
        from public.event_members em
        join public.members m on m.id = em.member_id
        left join public.checkins c on c.event_id = em.event_id and c.member_id = em.member_id
        where em.event_id = p_event_id
        group by m.member_unit
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
