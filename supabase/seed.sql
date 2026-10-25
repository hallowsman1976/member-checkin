-- LOCAL DEVELOPMENT ONLY (`supabase db reset`). Never run against production.
-- Test accounts (password for all: Passw0rd!local):
--   admin@checkin.test (admin, station S01) / super@checkin.test (supervisor)
--   staff1..staff8@checkin.test (staff, stations S01..S08) — one per notebook station

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('Passw0rd!local', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from (
  values
    ('10000000-0000-0000-0000-000000000001'::uuid, 'admin@checkin.test'),
    ('10000000-0000-0000-0000-000000000002'::uuid, 'super@checkin.test')
  union all
  select ('10000000-0000-0000-0000-0000000000' || lpad((n + 2)::text, 2, '0'))::uuid, 'staff' || n || '@checkin.test'
  from generate_series(1, 8) as n
) as u (id, email);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now()
from auth.users u
where u.email like '%@checkin.test';

insert into public.staff_profiles (id, full_name, role) values
  ('10000000-0000-0000-0000-000000000001', 'ผู้ดูแลระบบ ทดสอบ', 'admin'),
  ('10000000-0000-0000-0000-000000000002', 'หัวหน้างาน ทดสอบ', 'supervisor');
insert into public.staff_profiles (id, full_name, role)
select ('10000000-0000-0000-0000-0000000000' || lpad((n + 2)::text, 2, '0'))::uuid, 'เจ้าหน้าที่ จุด ' || n, 'staff'
from generate_series(1, 8) as n;

insert into public.stations (id, station_code, station_name)
select ('20000000-0000-0000-0000-00000000000' || n)::uuid, 'S0' || n, 'จุดลงทะเบียน ' || n
from generate_series(1, 8) as n;

insert into public.events (id, title, event_date, status) values
  ('30000000-0000-0000-0000-000000000001', 'ประชุมใหญ่สามัญประจำปี 2569', '2026-12-20', 'open');

insert into public.members (member_no, full_name, department, member_type) values
  ('000123', 'สมชาย ใจดี', 'สสจ.มุกดาหาร', 'ordinary'),
  ('001234', 'สมหญิง รักงาน', 'รพ.มุกดาหาร', 'ordinary'),
  ('012345', 'ประเสริฐ มั่นคง', 'รพ.สต.บางทรายใหญ่', 'associate'),
  ('100001', 'วิไลวรรณ ศรีสุข', 'รพ.ดอนตาล', 'ordinary');
insert into public.members (member_no, full_name, department, member_type, is_active) values
  ('100002', 'อนุชา พ้นสภาพ', 'รพ.นิคมคำสร้อย', 'ordinary', false);
-- Synthetic members for concurrency tests (member_no 900001..900100).
insert into public.members (member_no, full_name, department, member_type)
select (900000 + n)::text, 'สมาชิกทดสอบ ลำดับ' || n, 'หน่วยทดสอบ', 'ordinary'
from generate_series(1, 100) as n;

-- Default eligibility: all active members.
insert into public.event_members (event_id, member_id)
select '30000000-0000-0000-0000-000000000001', m.id
from public.members m
where m.is_active;

insert into public.staff_station_assignments (event_id, staff_id, station_id) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
insert into public.staff_station_assignments (event_id, staff_id, station_id)
select '30000000-0000-0000-0000-000000000001',
  ('10000000-0000-0000-0000-0000000000' || lpad((n + 2)::text, 2, '0'))::uuid,
  ('20000000-0000-0000-0000-00000000000' || n)::uuid
from generate_series(1, 8) as n;
