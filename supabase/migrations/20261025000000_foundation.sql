-- Phase 1 foundation: schema, constraints, role model, RLS.
-- Clients get SELECT only (scoped by RLS). Every mutation goes through
-- SECURITY DEFINER RPCs added in later phases, which also write audit_logs.

create extension if not exists pg_trgm with schema extensions;

-- Internal helpers live in `private`, which PostgREST does not expose.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.member_type as enum ('ordinary', 'associate');
create type public.event_status as enum ('draft', 'open', 'closed');
create type public.staff_role as enum ('admin', 'supervisor', 'staff');
create type public.checkin_status as enum ('active', 'cancelled');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.members (
  id uuid primary key default gen_random_uuid(),
  member_no text not null unique
    check (member_no <> '' and member_no = btrim(member_no)),
  full_name text not null check (btrim(full_name) <> ''),
  department text,
  member_type public.member_type not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index members_member_no_pattern_idx on public.members (member_no text_pattern_ops);
create index members_full_name_trgm_idx on public.members
  using gin (full_name extensions.gin_trgm_ops);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  event_date date not null,
  status public.event_status not null default 'draft',
  created_at timestamptz not null default now()
);
-- At most one open event; check-in always targets it.
create unique index events_single_open_idx on public.events ((true)) where status = 'open';

-- Per-event eligibility snapshot; "eligible" always means a row here.
create table public.event_members (
  event_id uuid not null references public.events (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (event_id, member_id)
);
create index event_members_member_idx on public.event_members (member_id);

create table public.staff_profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null check (btrim(full_name) <> ''),
  role public.staff_role not null default 'staff',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.stations (
  id uuid primary key default gen_random_uuid(),
  station_code text not null unique check (btrim(station_code) <> ''),
  station_name text not null check (btrim(station_name) <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.staff_station_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  staff_id uuid not null references public.staff_profiles (id) on delete restrict,
  station_id uuid not null references public.stations (id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
-- One active station per staff per event, so the server can derive the station.
create unique index staff_station_assignments_one_active_idx
  on public.staff_station_assignments (event_id, staff_id) where is_active;
create index staff_station_assignments_station_idx
  on public.staff_station_assignments (event_id, station_id);

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete restrict,
  staff_id uuid not null references public.staff_profiles (id) on delete restrict,
  station_id uuid not null references public.stations (id) on delete restrict,
  checked_in_at timestamptz not null default now(),
  status public.checkin_status not null default 'active',
  cancelled_at timestamptz,
  cancelled_by uuid references public.staff_profiles (id) on delete restrict,
  cancel_reason text,
  unique (event_id, member_id),
  -- Only eligible members can be checked in.
  foreign key (event_id, member_id) references public.event_members (event_id, member_id)
    on delete restrict,
  constraint checkins_cancel_fields_chk check (
    (status = 'active' and cancelled_at is null and cancelled_by is null and cancel_reason is null)
    or (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null
        and btrim(coalesce(cancel_reason, '')) <> '')
  )
);
create index checkins_event_time_idx on public.checkins (event_id, checked_in_at desc);
create index checkins_event_station_idx on public.checkins (event_id, station_id);
create index checkins_member_idx on public.checkins (member_id);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events (id) on delete restrict,
  actor_id uuid references public.staff_profiles (id) on delete restrict,
  action text not null check (btrim(action) <> ''),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_event_time_idx on public.audit_logs (event_id, created_at desc);
create index audit_logs_time_idx on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- Audit log is append-only, for every role including the owner.
-- ---------------------------------------------------------------------------

create function private.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function private.reject_audit_mutation();
create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function private.reject_audit_mutation();

-- Called by later SECURITY DEFINER RPCs; actor comes from the session.
create function private.write_audit(p_event_id uuid, p_action text, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (event_id, actor_id, action, details)
  values (p_event_id, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;
revoke all on function private.write_audit(uuid, text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Role helpers for RLS (SECURITY DEFINER so they can read staff_profiles
-- without recursive policy evaluation).
-- ---------------------------------------------------------------------------

create function private.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select sp.role
  from public.staff_profiles sp
  where sp.id = auth.uid() and sp.is_active;
$$;

create function private.has_role(variadic p_roles public.staff_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_staff_role() = any (p_roles), false);
$$;

revoke all on function private.current_staff_role() from public;
revoke all on function private.has_role(public.staff_role[]) from public;
revoke all on function private.reject_audit_mutation() from public;
grant execute on function private.current_staff_role() to authenticated;
grant execute on function private.has_role(public.staff_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges: SELECT only for authenticated; nothing for anon.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
grant select on
  public.members,
  public.events,
  public.event_members,
  public.staff_profiles,
  public.stations,
  public.staff_station_assignments,
  public.checkins,
  public.audit_logs
to authenticated;

-- New objects must opt in to client access explicitly.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.members enable row level security;
alter table public.events enable row level security;
alter table public.event_members enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.stations enable row level security;
alter table public.staff_station_assignments enable row level security;
alter table public.checkins enable row level security;
alter table public.audit_logs enable row level security;

create policy members_select on public.members
  for select to authenticated
  using (private.has_role('admin', 'supervisor', 'staff'));

create policy events_select on public.events
  for select to authenticated
  using (private.has_role('admin', 'supervisor', 'staff'));

create policy event_members_select on public.event_members
  for select to authenticated
  using (private.has_role('admin', 'supervisor', 'staff'));

create policy stations_select on public.stations
  for select to authenticated
  using (private.has_role('admin', 'supervisor', 'staff'));

-- Own profile is readable even when inactive, so the UI can explain why access is denied.
create policy staff_profiles_select on public.staff_profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.has_role('admin', 'supervisor'));

create policy staff_station_assignments_select on public.staff_station_assignments
  for select to authenticated
  using (
    (staff_id = (select auth.uid()) and private.has_role('admin', 'supervisor', 'staff'))
    or private.has_role('admin', 'supervisor')
  );

-- Staff see check-ins of the open event only (needed for registration status).
create policy checkins_select on public.checkins
  for select to authenticated
  using (
    private.has_role('admin', 'supervisor')
    or (
      private.has_role('staff')
      and exists (
        select 1 from public.events e
        where e.id = checkins.event_id and e.status = 'open'
      )
    )
  );

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (private.has_role('admin'));

-- ---------------------------------------------------------------------------
-- Session context for the UI (route guards, check-in header).
-- SECURITY INVOKER: reads only what RLS already allows the caller to see.
-- ---------------------------------------------------------------------------

create function public.get_my_context()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (
    select sp.id, sp.full_name, sp.role, sp.is_active
    from public.staff_profiles sp
    where sp.id = auth.uid()
  ),
  open_event as (
    select e.id, e.title, e.event_date, e.status
    from public.events e
    where e.status = 'open'
  ),
  my_station as (
    select s.id, s.station_code, s.station_name
    from public.staff_station_assignments a
    join public.stations s on s.id = a.station_id and s.is_active
    join open_event oe on oe.id = a.event_id
    where a.staff_id = auth.uid() and a.is_active
  )
  select jsonb_build_object(
    'staff', (select to_jsonb(me) from me),
    'open_event', (select to_jsonb(open_event) from open_event),
    'station', (select to_jsonb(my_station) from my_station)
  );
$$;
revoke all on function public.get_my_context() from public, anon;
grant execute on function public.get_my_context() to authenticated;
