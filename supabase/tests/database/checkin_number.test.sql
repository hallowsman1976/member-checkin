-- Run with `npm run db:test` (local Supabase, seed applied).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.register(p_no text) returns jsonb language sql as $$
  select public.register_member(
    '30000000-0000-0000-0000-000000000001',
    (select id from public.members where member_no = p_no)
  );
$$;

set local role authenticated;
select pg_temp.act_as('10000000-0000-0000-0000-000000000003');

select is((pg_temp.register('000123') -> 'checkin' ->> 'checkin_no')::int, 1, 'first check-in is number 1');
select is((pg_temp.register('000123') -> 'checkin' ->> 'checkin_no')::int, 1, 'repeat request keeps its number');
select is((pg_temp.register('001234') -> 'checkin' ->> 'checkin_no')::int, 2, 'a repeat uses no number: next is 2');
select is(
  (public.get_checkin_status('30000000-0000-0000-0000-000000000001',
    (select id from public.members where member_no = '001234')) -> 'checkin' ->> 'checkin_no')::int,
  2, 'get_checkin_status returns the number'
);
select is(
  (select array_agg((r ->> 'checkin_no')::int order by (r ->> 'checkin_no')::int)
   from jsonb_array_elements(public.list_checkins('30000000-0000-0000-0000-000000000001') -> 'rows') r),
  array[1, 2], 'history rows include the number'
);

reset role;
select throws_ok(
  $$update public.checkins set checkin_no = 1
    where event_id = '30000000-0000-0000-0000-000000000001' and checkin_no = 2$$,
  '23505', null, 'numbers are unique per event'
);

select * from finish();
rollback;
