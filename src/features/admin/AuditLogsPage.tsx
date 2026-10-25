import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Pager, selectClass } from '@/features/reports/EventFilters'
import { formatDateTime } from '@/lib/format'
import { supabase } from '@/lib/supabase'

const PAGE_SIZE = 50

export const actionLabels: Record<string, string> = {
  'members.import': 'นำเข้าสมาชิก',
  'member.activate': 'เปิดใช้งานสมาชิก',
  'member.deactivate': 'ตั้งสมาชิกพ้นสภาพ',
  'event.create': 'สร้างกิจกรรม',
  'event.update': 'แก้ไขกิจกรรม',
  'event.status': 'เปลี่ยนสถานะกิจกรรม',
  'eligibility.generate': 'สร้างรายชื่อผู้มีสิทธิ์',
  'eligibility.add': 'เพิ่มผู้มีสิทธิ์',
  'eligibility.remove': 'ลบผู้มีสิทธิ์',
  'station.create': 'เพิ่มจุดลงทะเบียน',
  'station.update': 'แก้ไขจุดลงทะเบียน',
  'staff.create': 'สร้างบัญชีเจ้าหน้าที่',
  'staff.update': 'แก้ไขบัญชีเจ้าหน้าที่',
  'staff.password_reset': 'ตั้งรหัสผ่านใหม่',
  'assignment.set': 'มอบหมายจุดลงทะเบียน',
  'checkin.cancel': 'ยกเลิกการลงทะเบียน',
  'checkin.reactivate': 'คืนสถานะการลงทะเบียน',
  'report.export': 'ส่งออกรายงาน',
}

const logSchema = z.object({
  id: z.guid(),
  action: z.string(),
  details: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  actor: z.object({ full_name: z.string() }).nullable(),
  event: z.object({ title: z.string() }).nullable(),
})

export function AuditLogsPage() {
  const [action, setAction] = useState('')
  const [offset, setOffset] = useState(0)

  const logs = useQuery({
    queryKey: ['audit-logs', action, offset],
    queryFn: async () => {
      let request = supabase
        .from('audit_logs')
        .select('id, action, details, created_at, actor:staff_profiles(full_name), event:events(title)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)
      if (action) request = request.eq('action', action)
      const { data, count, error } = await request
      if (error) throw error
      return { rows: z.array(logSchema).parse(data), total: count ?? 0 }
    },
    placeholderData: keepPreviousData,
  })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">บันทึกการตรวจสอบ</h1>
      <div className="space-y-1">
        <Label htmlFor="al-action">ประเภทการกระทำ</Label>
        <select
          id="al-action"
          className={`${selectClass} block`}
          value={action}
          onChange={(e) => {
            setAction(e.target.value)
            setOffset(0)
          }}
        >
          <option value="">ทั้งหมด</option>
          {Object.entries(actionLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="border-b border-border bg-background text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">เวลา</th>
              <th className="px-4 py-2 font-medium">ผู้ดำเนินการ</th>
              <th className="px-4 py-2 font-medium">การกระทำ</th>
              <th className="px-4 py-2 font-medium">กิจกรรม</th>
              <th className="px-4 py-2 font-medium">รายละเอียด</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border align-top">
            {logs.data?.rows.map((log) => (
              <tr key={log.id}>
                <td className="whitespace-nowrap px-4 py-2 tabular-nums">{formatDateTime(log.created_at)}</td>
                <td className="px-4 py-2">{log.actor?.full_name ?? '-'}</td>
                <td className="px-4 py-2">{actionLabels[log.action] ?? log.action}</td>
                <td className="px-4 py-2">{log.event?.title ?? '-'}</td>
                <td className="px-4 py-2">
                  <code className="block max-w-xl whitespace-pre-wrap break-all text-xs text-muted">
                    {JSON.stringify(log.details)}
                  </code>
                </td>
              </tr>
            ))}
            {logs.data?.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted">
                  ไม่มีรายการ
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {logs.data && <Pager total={logs.data.total} limit={PAGE_SIZE} offset={offset} onOffset={setOffset} />}
    </div>
  )
}
