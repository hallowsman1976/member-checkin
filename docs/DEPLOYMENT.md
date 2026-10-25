# การติดตั้งระบบจริง (Production)

ระบบมี 2 ส่วน: **Supabase** (ฐานข้อมูล, Auth, Realtime, Edge Function) และ **Cloudflare Pages** (หน้าเว็บ static)
ทำตามลำดับด้านล่างครั้งเดียว ปีถัดไปใช้โปรเจกต์เดิม เพียงสร้างกิจกรรมใหม่ (ดู `OPERATIONS.md`)

## 1. Supabase project

1. สร้างโปรเจกต์ใหม่ที่ <https://supabase.com/dashboard> เลือก region **Southeast Asia (Singapore)**
   - แนะนำแผน **Pro** อย่างน้อยช่วงเดือนที่จัดงาน: แผน Free ไม่มี backup อัตโนมัติ และโปรเจกต์จะถูก pause เมื่อไม่มีการใช้งาน 7 วัน
2. ผูกโปรเจกต์และส่ง migration (seed ข้อมูลทดสอบจะ **ไม่** ถูกส่งขึ้น):

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

3. Deploy Edge Function และจำกัด origin ให้เป็นโดเมนของหน้าเว็บ:

   ```bash
   npx supabase functions deploy admin-staff
   npx supabase secrets set ALLOWED_ORIGINS=https://<your-pages-domain>
   ```

   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` ถูกตั้งให้ function อัตโนมัติ — **ห้าม** ใส่ service role key ในหน้าเว็บหรือ Cloudflare

4. ตั้งค่า **Authentication** ใน Dashboard (ค่าใน `supabase/config.toml` ใช้กับเครื่อง local เท่านั้น):
   - Sign In / Providers → Email: **เปิด** Email provider, **ปิด** "Allow new users to sign up", ปิด "Confirm email"
   - Anonymous sign-ins: **ปิด**
   - Password: ขั้นต่ำ **8** ตัว, ต้องมี **letters and digits**
   - URL Configuration → Site URL: `https://<your-pages-domain>`
   - Rate limits → sign-in: ค่าเริ่มต้น 30 ครั้ง/5 นาที/IP เพียงพอสำหรับ 8 เครื่อง (ทุกเครื่องในงานมักออก IP เดียวกันผ่าน NAT — อย่าให้ทุกคน login ผิดซ้ำ ๆ พร้อมกัน)
5. สร้าง **admin คนแรก** (ครั้งเดียว):
   - Authentication → Users → Add user → ใส่อีเมล/รหัสผ่าน และติ๊ก Auto Confirm
   - SQL Editor:

     ```sql
     insert into public.staff_profiles (id, full_name, role)
     select id, 'ชื่อ-สกุลผู้ดูแลระบบ', 'admin' from auth.users where email = 'admin@example.org';
     ```

   บัญชีอื่นทั้งหมดสร้างจากหน้า **เจ้าหน้าที่และจุดลงทะเบียน** ในแอป
6. ตรวจความปลอดภัยฐานข้อมูล: Dashboard → Advisors → Security / Performance ต้องไม่มี error

## 2. Cloudflare Pages

1. Workers & Pages → Create → Pages → เชื่อม Git repository (หรืออัปโหลดด้วย `npm run deploy:pages`)
2. Build settings: Framework **None**, Build command `npm run build`, Output directory `dist`, Node 22
3. Environment variables (Production, ใช้ตอน build):
   - `VITE_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = anon / publishable key (ปลอดภัยที่จะอยู่ในเบราว์เซอร์ — สิทธิ์ทั้งหมดบังคับด้วย RLS และ RPC)
4. ไฟล์ที่ deploy ไปพร้อมกัน (อยู่ใน `public/`):
   - `_redirects` — SPA fallback ให้ทุก path เปิด `index.html`
   - `_headers` — CSP (อนุญาตเฉพาะตัวเองและ `*.supabase.co`), HSTS, X-Frame-Options, no-referrer, noindex
   ถ้าใช้ custom domain ของ Supabase ต้องเพิ่มโดเมนนั้นใน `connect-src` ของ `_headers`
5. หลัง deploy เปิดเว็บ → กด F12 → Console ต้องไม่มีข้อความ "Content Security Policy"

## 3. ตรวจหลัง deploy (smoke test)

- [ ] login ด้วย admin ได้ และเห็นเมนูครบ 8 เมนู
- [ ] สมัครสมาชิกเองไม่ได้ (ไม่มีหน้า sign-up และ API ตอบ `signup_disabled`)
- [ ] สร้างบัญชี staff ทดสอบจากหน้าเว็บได้ → login ด้วยบัญชีนั้นได้ → ปิดใช้งานบัญชีทดสอบ
- [ ] แดชบอร์ดแสดง "อัปเดตสด"
- [ ] ส่งออก Excel ได้ และมีรายการใน "บันทึกการตรวจสอบ"

## 4. การทดสอบก่อนใช้งานจริง (บนเครื่องนักพัฒนา)

```bash
npm run db:start
npm run db:reset
npm run db:test
npm run test
npm run test:integration
npm run test:load
```

`test:load` จำลอง 8 จุดพร้อมกันกับสมาชิก 1,500 คน และรายงาน p50/p95 — รันกับ staging ได้โดยตั้ง
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (ต้องมีบัญชี `staff1..8@checkin.test` และกิจกรรมที่เปิดอยู่;
ห้ามรันกับ production เพราะจะเพิ่มและลบสมาชิกทดสอบ)
