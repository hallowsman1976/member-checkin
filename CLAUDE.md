# SMART MEMBER CHECK-IN 2569

**Current phase: 5 complete (2026-10-25); all phases done.** Deployment: `docs/DEPLOYMENT.md`; event-day runbook and offline fallback: `docs/OPERATIONS.md`. Work only on the phase the user's prompt names; stop when it is verified. Phase prompts live in `docs/PHASE_PROMPTS.md` (for the human; update this line when a phase completes).

## ROLE & OUTPUT RULES

Act as a senior full-stack engineer, PostgreSQL architect, security engineer and UI/UX designer. Build an actual, maintainable application, not a mockup. Thai UI, English code/identifiers. Respond concisely in Thai.

**Token-saving rules (strict):**
- Inspect the repository before coding. Reuse existing code; extend existing work instead of re-scaffolding.
- Modify only necessary files. In Claude Code, edit files directly; in chat show only the changed parts.
- Keep explanations short; add only required features, libraries and abstractions.
- Run applicable typecheck/build/tests, fix errors, and finish with: changed files, test results, blockers, next phase (max 10 lines).
- Report only tests actually executed. For missing credentials use environment placeholders; secrets live only in env vars.
- If an ambiguity is not security-critical, choose a reasonable default and proceed.

## PROJECT

- App: **Smart Member Check-in 2569**
- Organization: **สหกรณ์ออมทรัพย์สาธารณสุขจังหวัดมุกดาหาร จำกัด**
- Use case: annual cooperative general meeting check-in, reusable in future years
- ~1,500 members; **8 notebook stations** registering concurrently
- A staff member searches by **member number or Thai full name**, checks physical ID, confirms check-in, then proceeds to next person
- One effective check-in per member per event, even under concurrent requests
- Fast keyboard-first experience, optimized for 1366×768 notebook screens
- Time: store `timestamptz`; display and report in `Asia/Bangkok`; show dates in Buddhist Era (พ.ศ.)

## REQUIRED TECH STACK

- Frontend: React + Vite + TypeScript (strict mode)
- Styles: Tailwind CSS + shadcn/ui, Noto Sans Thai, Lucide React
- Routing: React Router
- Server state: TanStack Query; use Zustand only if genuinely needed
- Auth: Supabase Auth (public sign-up disabled)
- Database: Supabase PostgreSQL; schema migrations + RLS
- Secure business logic: PostgreSQL RPC and/or Supabase Edge Functions
- Live updates: Supabase Realtime + periodic refetch/reconciliation
- Validation: Zod; notifications: Sonner
- Exports: ExcelJS / CSV
- Tests: Vitest (frontend/unit), SQL tests (pgTAP) against local Supabase (`supabase start`, requires Docker), Playwright (E2E)
- Deployment: Cloudflare Pages (static frontend)

Keep all server logic in PostgreSQL RPC and Edge Functions; add a separate application server only with demonstrated need.

## ROLES & AUTHORIZATION

- `admin`: manage events, eligibility, staff, import members, check-ins, corrections, exports, audit logs
- `supervisor`: read-only — dashboards, history, reports, exports
- `staff`: search members and register at the assigned station; view permitted history
- One authenticated account per staff member. Enforce every role check on the server; UI checks are convenience only.
- Store roles in `staff_profiles` linked to `auth.users`; server-side check active account and assigned station.
- Admins create staff accounts through an admin-only Edge Function that holds the service role key server-side; the browser uses only the anon key.
- Checking in requires an active station assignment for the open event, for staff and admin alike. Supervisors cannot check in.

## DOMAIN & DATA MODEL

Use UUID primary keys. Minimum entities:

1. `members`: id, member_no (TEXT UNIQUE; preserve leading zeros), full_name, department, member_type (`ordinary`/`associate`), is_active, created_at
2. `events`: id, title, event_date, status (`draft`/`open`/`closed`), created_at. **At most one `open` event** (partial unique index on `status = 'open'`); check-in always targets it.
3. `event_members`: event_id, member_id, PRIMARY KEY (event_id, member_id). Per-event eligibility snapshot, so past events keep their totals when the member list changes. Default generation: all active members of both types; admin may adjust while the event is `draft`.
4. `staff_profiles`: id FK auth.users, full_name, role, is_active
5. `stations`: id, station_code UNIQUE, station_name, is_active
6. `staff_station_assignments`: staff_id, station_id, event_id, is_active; **at most one active assignment per (event_id, staff_id)**
7. `checkins`: id, event_id FK, member_id FK, staff_id FK, station_id FK, checked_in_at timestamptz DEFAULT now(), status (`active`/`cancelled`), cancelled_at, cancelled_by, cancel_reason; **UNIQUE(event_id, member_id)**
8. `audit_logs`: id, event_id, actor_id, action, details jsonb, created_at. **Append-only:** revoke UPDATE/DELETE from every client role; write only through security-definer functions.

"Eligible" always means a row in `event_members`. Treat the database as the source of truth. Use migrations in `supabase/migrations/`.

**Search & indexes:** member_no exact/prefix via btree (`text_pattern_ops`); Thai name via `ILIKE '%q%'` on whitespace-normalized input, with a `pg_trgm` GIN index. pg_trgm splits on characters the DB locale treats as non-alphanumeric, so verify Thai behaviour on the actual Supabase database; a sequential scan over ~1,500 rows is an acceptable fallback. Also index check-ins by event/time/station.

### CRITICAL: ATOMIC CHECK-IN

Provide `register_member(event_id, member_id)` via a security-reviewed RPC that:
- Derives staff identity from the authenticated session and the station from that staff's active assignment for the event; the client supplies neither.
- Confirms on the server: active staff, allowed role, active assignment, active station, member eligible for the event, and event currently `open`.
- Uses one PostgreSQL transaction and `UNIQUE(event_id, member_id)` with `INSERT ... ON CONFLICT DO NOTHING`, then reads the existing row when nothing was inserted.
- Returns: `registered`; `already_registered` (with original check-in time/station); `cancelled` (an existing cancelled check-in — admin must reactivate); or a well-defined error code.
- Handles concurrent requests from different notebook stations safely.
- Leaves `checkins` writable only through RPCs: revoke direct INSERT/UPDATE/DELETE from client roles; use `SECURITY DEFINER` with `SET search_path = ''` and explicit function grants.
- Serializes against a concurrent event close (lock the event row `FOR SHARE`; closing takes `FOR UPDATE`).
- Registers existing members only; an unknown member is an error.

**Cancellation & reactivation** (admin-only RPCs, reason required, each appends an audit event): cancel sets `status = 'cancelled'` with cancelled_at/by/reason; reactivate sets the same row back to `active`, keeping one row per (event, member). History is preserved, never deleted.

**Unknown outcome:** when a connection fails after submission, the result is unknown. Provide `get_checkin_status(event_id, member_id)`; the UI calls it before allowing a retry and shows success only when the server confirms it.

## REQUIRED FEATURES

### 1. Login
- Staff login/logout, session handling, protected routes and server-side role enforcement.
- Assigned station shown in the check-in header.

### 2. Check-in
- Search by member number (including zeros) and Thai full name; debounce ~300 ms; limit 20 results.
- Keyboard-first selection, large controls, simple Thai messages.
- Show member no., name, department, type, and event-specific registration status.
- Staff verify the physical ID visually before confirming. Store no Thai citizen ID.
- Disable duplicate submits; show loading, success, already-registered, cancelled, error and unknown/network states.
- After success, reset to focused search input.

### 3. Admin Dashboard
- Total eligible, registered, remaining, completion percentage.
- Count by station, member type and recent registrations.
- Realtime invalidates/refetches authoritative database totals; periodic reconciliation on reconnect.

### 4. Admin & Reporting
- CSV/Excel import with preview, validation, duplicate handling and error report.
- User and station management; event eligibility; event open/close.
- Registration history; registered/unregistered lists; filter by station/type/time; Excel/CSV export.
- Exports (PDPA): admin/supervisor only, minimal fields, each export recorded in the audit log.
- Audit log for sensitive changes, including corrections, imports and exports.

### 5. Offline fallback
No offline mode in the app. Before the event, export the eligible list for print. During an outage, staff record check-ins on paper; afterwards an admin enters them through the normal RPC.

## ROUTES

- `/login` — all
- `/check-in` — staff/admin with an active assignment
- `/history` — authorized staff/admin/supervisor (scoped as appropriate)
- `/dashboard` — admin/supervisor
- `/members` — admin
- `/staff` — admin
- `/reports` — admin/supervisor
- `/settings` — admin
- `/audit-logs` — admin

## UI/UX DESIGN TOKENS

- Style: modern minimal SaaS, blue/white, high contrast, uncluttered
- Primary `#1463A5`; primary soft `#EAF4FF`; background `#F8FAFC`
- Success `#16A34A`; warning `#F59E0B`; danger `#DC2626`; text `#0F172A`
- Noto Sans Thai; desktop-first for 1366×768 with responsive tablet/mobile support
- Staff page: compact topbar, huge search field, member result list, prominent confirm button; minimal navigation
- Admin: sidebar, KPI cards, live activity, station breakdown, reports
- Accessible keyboard flow, dialogs, skeleton/loading, empty/error states. Subtle, minimal animation.

## SUGGESTED PROJECT STRUCTURE

```text
src/
  app/             # routes, providers
  components/ui/   # shared primitives
  features/
    auth/
    checkin/
    members/
    dashboard/
    reports/
    admin/
  lib/             # supabase client, utilities
  types/
  styles/
supabase/
  migrations/
  functions/
  tests/
.env.example
```

## TEST REQUIREMENTS

- Search exact member no., leading zero, Thai partial names (on the real DB locale), nonexistent member
- Successful registration and return value
- Simultaneous attempts for same member on 2 and 8 stations: **exactly one saved check-in**
- 8 concurrent staff, different members, no lost writes
- Unauthorized/inactive staff, no assignment, inactive station, ineligible member, draft/closed event
- Second open event rejected
- Race with event closure, repeated requests, request timeout/unknown outcome via `get_checkin_status`
- Admin cancellation/reactivation with audit trail; registering a cancelled check-in returns `cancelled`
- Direct table writes to `checkins`/`audit_logs` rejected for client roles
- Realtime dashboard totals reconcile to database
- Import validation, role-based export permissions, Excel accuracy
- Build/typecheck, integration and basic end-to-end tests as feasible

Performance targets to measure (not guarantees): search p95 < 1s, confirm p95 < 2s, dashboard update ~1–3s on the actual venue connection.

## IMPLEMENTATION PHASES

1. **Foundation:** inspect/create Vite app, design tokens, Supabase client, SQL migrations (all tables and constraints above), RLS, auth, route guards, secure role/station model; verify build.
2. **Registration:** member search, detail/identity verification, atomic RPC, duplicate/cancelled handling, unknown-outcome recovery, keyboard-first UI and concurrency tests.
3. **Dashboard:** authoritative aggregate queries, Realtime, history, reporting and audited Excel/CSV exports.
4. **Administration:** import, eligibility generation, staff accounts (Edge Function), stations/assignments, event settings, auditable corrections, server-side admin permissions.
5. **Production:** threat review, load/concurrency tests, failure recovery, offline fallback procedure, deployment on Cloudflare Pages, backup/operational checklist.

Advance to the next phase only when the user explicitly asks.
