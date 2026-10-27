import { AlertTriangle, CheckCircle2, Loader2, Upload } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useEvents } from '@/features/reports/api'
import { adminRpc, AdminError, useAdminMutation } from './api'
import { parseImportTable, readImportFile, type ParsedImport } from './importParser'

type Preview = {
  inserted: number
  updated: number
  unchanged: number
  /** Present for an event-roster import. */
  eligible?: number
  previous_eligible?: number
  by_station?: { station_code: string | null; count: number }[]
}
type ServerRowError = { row: number; member_no: string; code: string }

const serverRowMessages: Record<string, string> = {
  member_no_required: 'ไม่มีเลขสมาชิก',
  member_no_invalid: 'เลขสมาชิกมีช่องว่าง',
  duplicate_in_file: 'เลขสมาชิกซ้ำในไฟล์',
  full_name_required: 'ไม่มีชื่อ-สกุล',
  member_type_invalid: 'ประเภทสมาชิกไม่ถูกต้อง',
  station_not_found: 'ไม่พบจุดลงทะเบียนตามรหัสนี้ (สร้างจุดในหน้าตั้งค่าก่อน)',
  station_inactive: 'จุดลงทะเบียนถูกปิดใช้งาน',
  payout_seq_invalid: 'ลำดับไม่ถูกต้อง',
  duplicate_payout_seq: 'ลำดับซ้ำในจุดเดียวกัน',
}

/** Roster import replaces the event's eligibility; otherwise only member data is upserted. */
function importRpc(eventId: string, rows: ParsedImport['rows'], dryRun: boolean) {
  return eventId
    ? adminRpc('import_event_roster', { p_event_id: eventId, p_rows: rows, p_dry_run: dryRun })
    : adminRpc('import_members', { p_rows: rows, p_dry_run: dryRun })
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [serverErrors, setServerErrors] = useState<ServerRowError[]>([])
  const draftEvents = (useEvents().data ?? []).filter((e) => e.status === 'draft')
  // '' = members only; undefined = not chosen yet (defaults to the first draft event).
  const [chosenEventId, setChosenEventId] = useState<string>()
  const eventId = chosenEventId ?? draftEvents[0]?.id ?? ''

  const commit = useAdminMutation(
    (rows: ParsedImport['rows']) => importRpc(eventId, rows, false),
    { success: 'นำเข้าข้อมูลสมาชิกแล้ว', invalidate: [['members'], ['admin-events'], ['report']] },
  )

  function reset() {
    setFileName(null)
    setParsed(null)
    setPreview(null)
    setServerErrors([])
  }

  async function handleFile(file: File | undefined) {
    reset()
    if (!file) return
    setFileName(file.name)
    setBusy(true)
    try {
      const result = parseImportTable(await readImportFile(file))
      setParsed(result)
      if (result.issues.length > 0) return
      // Server-side preview validates again and counts inserts/updates without changing anything.
      const dry = await importRpc(eventId, result.rows, true)
      setPreview(dry as unknown as Preview)
    } catch (error) {
      if (error instanceof AdminError && error.result?.errors) {
        setServerErrors(error.result.errors as ServerRowError[])
      } else {
        setParsed({ rows: [], hasRoster: false, lines: [], issues: [{ line: 0, message: error instanceof Error ? error.message : 'อ่านไฟล์ไม่สำเร็จ' }], warnings: [] })
      }
    } finally {
      setBusy(false)
    }
  }

  function close() {
    reset()
    onClose()
  }

  const issues = parsed?.issues ?? []
  const lineOf = (row: number) => parsed?.lines[row - 1] ?? row

  return (
    <Dialog open={open} onClose={close} title="นำเข้าข้อมูลสมาชิก" className="max-w-2xl">
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          รองรับไฟล์ .xlsx และ .csv (UTF-8) คอลัมน์ที่ต้องมี: <b>เลขสมาชิก</b>, <b>ชื่อ-สกุล</b>, <b>ประเภทสมาชิก</b> (สามัญ/สมทบ)
          · ไม่บังคับ: หน่วยงาน, สถานะ (ใช้งาน/พ้นสภาพ), หน่วยสมาชิก, จุดลงทะเบียน (รหัสจุด), ลำดับ (ลำดับจ่ายค่าตอบแทน)
          · สมาชิกที่มีเลขเดิมจะถูกอัปเดต ไม่มีการลบ
        </p>
        <label className="block space-y-1">
          <span className="font-medium">นำเข้าเป็นรายชื่อผู้มีสิทธิ์ของกิจกรรม</span>
          <select
            className="h-10 w-full rounded-md border border-border bg-surface px-3"
            value={eventId}
            disabled={busy || commit.isPending}
            onChange={(e) => {
              setChosenEventId(e.target.value)
              reset()
            }}
          >
            {draftEvents.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} (ร่าง) — แทนที่รายชื่อผู้มีสิทธิ์ทั้งหมดด้วยไฟล์นี้
              </option>
            ))}
            <option value="">ไม่ผูกกิจกรรม — อัปเดตข้อมูลสมาชิกเท่านั้น</option>
          </select>
        </label>
        {parsed?.hasRoster && !eventId && (
          <p className="flex gap-2 rounded-lg bg-warning/10 p-3">
            <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
            ไฟล์มีจุดลงทะเบียน/ลำดับ แต่ไม่ได้เลือกกิจกรรม ข้อมูลสองคอลัมน์นี้จะไม่ถูกบันทึก
          </p>
        )}
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 hover:bg-primary-soft">
          <Upload className="size-5 text-primary" aria-hidden />
          <span>{fileName ?? 'เลือกไฟล์'}</span>
          <input
            type="file"
            accept=".xlsx,.csv"
            className="sr-only"
            onChange={(e) => {
              void handleFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>

        {busy && (
          <p className="flex items-center gap-2 text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden /> กำลังตรวจสอบ…
          </p>
        )}

        {parsed?.warnings.map((w) => (
          <p key={w} className="flex gap-2 rounded-lg bg-warning/10 p-3">
            <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden /> {w}
          </p>
        ))}

        {(issues.length > 0 || serverErrors.length > 0) && (
          <div className="space-y-2">
            <p className="font-semibold text-danger">
              พบข้อผิดพลาด {issues.length + serverErrors.length} รายการ — แก้ไขไฟล์แล้วนำเข้าใหม่ (ยังไม่มีการบันทึกข้อมูล)
            </p>
            <ul className="max-h-60 overflow-auto rounded-lg border border-border">
              {issues.map((i, n) => (
                <li key={`c${n}`} className="border-b border-border px-3 py-1.5 last:border-0">
                  {i.line > 0 && <span className="mr-2 text-muted">แถว {i.line}</span>}
                  {i.message}
                </li>
              ))}
              {serverErrors.map((e) => (
                <li key={`s${e.row}`} className="border-b border-border px-3 py-1.5 last:border-0">
                  <span className="mr-2 text-muted">แถว {lineOf(e.row)}</span>
                  {e.member_no && <span className="mr-2 font-mono">{e.member_no}</span>}
                  {serverRowMessages[e.code] ?? e.code}
                </li>
              ))}
            </ul>
          </div>
        )}

        {preview && parsed && (
          <div className="space-y-3 rounded-lg border border-success/40 bg-success/10 p-4">
            <p className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="size-5 text-success" aria-hidden />
              ตรวจสอบผ่าน {parsed.rows.length.toLocaleString('th-TH')} แถว
            </p>
            <p>
              เพิ่มใหม่ <b>{preview.inserted.toLocaleString('th-TH')}</b> · อัปเดต <b>{preview.updated.toLocaleString('th-TH')}</b> ·
              ไม่เปลี่ยนแปลง <b>{preview.unchanged.toLocaleString('th-TH')}</b>
            </p>
            {preview.eligible !== undefined && (
              <p>
                ผู้มีสิทธิ์ของกิจกรรมจะเป็น <b>{preview.eligible.toLocaleString('th-TH')}</b> คน (เดิม{' '}
                {(preview.previous_eligible ?? 0).toLocaleString('th-TH')} คน)
                {preview.by_station && preview.by_station.length > 0 && (
                  <span className="block text-xs text-muted">
                    {preview.by_station.map((s) => `จุด ${s.station_code ?? '-'}: ${s.count}`).join(' · ')}
                  </span>
                )}
              </p>
            )}
            <table className="w-full text-xs">
              <thead className="text-left text-muted">
                <tr>
                  <th>เลขสมาชิก</th>
                  <th>ชื่อ-สกุล</th>
                  <th>หน่วยงาน</th>
                  <th>ประเภท</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 5).map((r) => (
                  <tr key={r.member_no}>
                    <td className="font-mono">{r.member_no}</td>
                    <td>{r.full_name}</td>
                    <td>{r.department ?? '-'}</td>
                    <td>{r.member_type === 'ordinary' ? 'สามัญ' : 'สมทบ'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.rows.length > 5 && <p className="text-xs text-muted">…และอีก {parsed.rows.length - 5} แถว</p>}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            ปิด
          </Button>
          <Button
            disabled={!preview || !parsed || commit.isPending}
            onClick={() => parsed && commit.mutate(parsed.rows, { onSuccess: close })}
          >
            {commit.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            ยืนยันนำเข้า
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
