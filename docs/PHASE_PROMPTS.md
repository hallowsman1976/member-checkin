# Phase Prompts — Smart Member Check-in 2569

ไฟล์นี้สำหรับคน ไม่ได้โหลดอัตโนมัติ คัดลอก prompt ของ phase ที่ต้องการไปส่งให้ Claude Code ทีละ phase
(`CLAUDE.md` ที่ root ถูกโหลดทุกเซสชันอยู่แล้ว) เมื่อจบแต่ละ phase ให้อัปเดตบรรทัด `Current phase` ใน `CLAUDE.md`

ส่ง prompt ถัดไปเมื่อ phase ก่อนหน้าเสร็จและตรวจแล้วเท่านั้น

## Phase 1 — Foundation

```text
Implement Phase 1 following CLAUDE.md. Inspect existing files first. If the repository has no app, scaffold Vite + React + TypeScript. Create the minimum required migrations (including event_members and the single-open-event constraint), robust RLS/auth patterns, the station assignment model, route protection, .env.example and core layout. Run available checks and fix failures. Report concisely: changed files, executed checks, blockers, next action. Do not start Phase 2.
```

## Phase 2 — Registration

```text
Implement Phase 2 following CLAUDE.md. Build member search, identity review, atomic RPC check-in (station derived server-side), duplicate/cancelled/network handling and concurrency tests. Modify only necessary files. Run tests. Summarize briefly. Stop before Phase 3.
```

## Phase 3 — Dashboard & Reports

```text
Implement Phase 3 following CLAUDE.md. Add authoritative realtime dashboard, scoped history, reports and Excel/CSV export (audited). Verify totals against event_members and authorization. Run checks. Summarize briefly. Stop before Phase 4.
```

## Phase 4 — Administration

```text
Implement Phase 4 following CLAUDE.md. Add admin-only member import, event eligibility generation, staff account creation via Edge Function, staff/station assignments, event lifecycle, auditable cancellation/reactivation. Enforce permissions server-side. Test and summarize. Stop before Phase 5.
```

## Phase 5 — Production

```text
Implement Phase 5 following CLAUDE.md. Review security, run concurrent 8-station tests, validate connection-failure recovery, add Cloudflare Pages deployment config, the offline fallback procedure and an operational checklist. Fix issues and list any remaining blockers.
```
