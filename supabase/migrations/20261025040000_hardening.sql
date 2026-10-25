-- Phase 5 security review fixes.

-- get_checkin_status: staff may only look up the open event (matches checkins RLS);
-- admin/supervisor may look up any event.
create or replace function public.get_checkin_status(p_event_id uuid, p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.staff_role := private.current_staff_role();
  v_existing jsonb;
begin
  if v_role is null then
    return jsonb_build_object('result', 'error', 'code', 'staff_inactive');
  end if;
  if v_role = 'staff' and not exists (select 1 from public.events where id = p_event_id and status = 'open') then
    return jsonb_build_object('result', 'error', 'code', 'event_not_open');
  end if;

  v_existing := private.checkin_json(p_event_id, p_member_id);
  if v_existing is null then
    return jsonb_build_object('result', 'not_registered');
  end if;
  return jsonb_build_object('result', v_existing ->> 'status', 'checkin', v_existing);
end;
$$;

-- RLS performance: wrap role checks in (select ...) so Postgres evaluates them once per
-- statement (initPlan) instead of once per row. Measured as staff on 1,605 members:
-- search_members 140 ms -> 13 ms.
alter policy members_select on public.members
  using ((select private.has_role('admin', 'supervisor', 'staff')));
alter policy events_select on public.events
  using ((select private.has_role('admin', 'supervisor', 'staff')));
alter policy event_members_select on public.event_members
  using ((select private.has_role('admin', 'supervisor', 'staff')));
alter policy stations_select on public.stations
  using ((select private.has_role('admin', 'supervisor', 'staff')));
alter policy staff_profiles_select on public.staff_profiles
  using (id = (select auth.uid()) or (select private.has_role('admin', 'supervisor')));
alter policy staff_station_assignments_select on public.staff_station_assignments
  using (
    (staff_id = (select auth.uid()) and (select private.has_role('admin', 'supervisor', 'staff')))
    or (select private.has_role('admin', 'supervisor'))
  );
alter policy checkins_select on public.checkins
  using (
    (select private.has_role('admin', 'supervisor'))
    or (
      (select private.has_role('staff'))
      and event_id in (select e.id from public.events e where e.status = 'open')
    )
  );
alter policy audit_logs_select on public.audit_logs
  using ((select private.has_role('admin')));
