import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search, Upload } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { memberTypeLabels } from '@/features/checkin/labels'
import { useDebouncedValue } from '@/features/checkin/useDebouncedValue'
import { Pager } from '@/features/reports/EventFilters'
import { supabase } from '@/lib/supabase'
import { adminRpc, useAdminMutation } from './api'
import { ImportDialog } from './ImportDialog'

const PAGE_SIZE = 50

const memberSchema = z.object({
  id: z.guid(),
  member_no: z.string(),
  full_name: z.string(),
  department: z.string().nullable(),
  member_type: z.enum(['ordinary', 'associate']),
  is_active: z.boolean(),
})

// PostgREST filter syntax uses , ( ) and LIKE uses % _ — strip them from free text.
const sanitize = (q: string) => q.replace(/[,()%_*\\"]/g, ' ').replace(/\s+/g, ' ').trim()

export function MembersPage() {
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [importing, setImporting] = useState(false)
  const q = sanitize(useDebouncedValue(query, 300))

  const members = useQuery({
    queryKey: ['members', q, offset],
    queryFn: async () => {
      let request = supabase
        .from('members')
        .select('id, member_no, full_name, department, member_type, is_active', { count: 'exact' })
        .order('member_no')
        .range(offset, offset + PAGE_SIZE - 1)
      if (q) request = request.or(`member_no.like.${q}*,full_name.ilike.*${q}*`)
      const { data, count, error } = await request
      if (error) throw error
      return { rows: z.array(memberSchema).parse(data), total: count ?? 0 }
    },
    placeholderData: keepPreviousData,
  })

  const toggle = useAdminMutation(
    (vars: { id: string; active: boolean }) => adminRpc('set_member_active', { p_member_id: vars.id, p_is_active: vars.active }),
    { success: 'บันทึกแล้ว', invalidate: [['members']] },
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">สมาชิก</h1>
        <Button onClick={() => setImporting(true)}>
          <Upload className="size-4" aria-hidden />
          นำเข้าจาก Excel / CSV
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOffset(0)
          }}
          placeholder="ค้นหาเลขสมาชิก หรือ ชื่อ"
          aria-label="ค้นหาสมาชิก"
          className="pl-9"
        />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="border-b border-border bg-background text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">เลขสมาชิก</th>
              <th className="px-4 py-2 font-medium">ชื่อ-สกุล</th>
              <th className="px-4 py-2 font-medium">หน่วยงาน</th>
              <th className="px-4 py-2 font-medium">ประเภท</th>
              <th className="px-4 py-2 font-medium">สถานะ</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members.isPending ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  กำลังโหลด…
                </td>
              </tr>
            ) : members.isError ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-danger">
                  โหลดข้อมูลไม่สำเร็จ
                </td>
              </tr>
            ) : members.data.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  ไม่พบสมาชิก
                </td>
              </tr>
            ) : (
              members.data.rows.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2 font-mono">{m.member_no}</td>
                  <td className="px-4 py-2">{m.full_name}</td>
                  <td className="px-4 py-2">{m.department ?? '-'}</td>
                  <td className="px-4 py-2">{memberTypeLabels[m.member_type]}</td>
                  <td className="px-4 py-2">
                    {m.is_active ? <span className="text-success">ใช้งาน</span> : <span className="text-danger">พ้นสภาพ</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={toggle.isPending}
                      onClick={() => {
                        const verb = m.is_active ? 'ตั้งเป็นพ้นสภาพ' : 'เปิดใช้งาน'
                        if (window.confirm(`${verb}: ${m.member_no} ${m.full_name}?`)) {
                          toggle.mutate({ id: m.id, active: !m.is_active })
                        }
                      }}
                    >
                      {m.is_active ? 'ตั้งเป็นพ้นสภาพ' : 'เปิดใช้งาน'}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
      {members.data && <Pager total={members.data.total} limit={PAGE_SIZE} offset={offset} onOffset={setOffset} />}

      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </div>
  )
}
