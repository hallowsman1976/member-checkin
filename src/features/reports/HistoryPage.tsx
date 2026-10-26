import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { adminRpc, useAdminMutation } from '@/features/admin/api'
import { useStaffContext } from '@/features/auth/StaffContext'
import { memberTypeLabels } from '@/features/checkin/labels'
import { formatDateTime } from '@/lib/format'
import { fetchHistory, type Filters, type HistoryRow } from './api'
import { EventSelect, FilterBar, Pager, useSelectedEvent } from './EventFilters'

const PAGE_SIZE = 50

type Correction = { row: HistoryRow; action: 'cancel' | 'reactivate' }

/** Admin-only: cancel or reactivate a check-in with a mandatory reason (audited server-side). */
function CorrectionDialog({ correction, onClose }: { correction: Correction | null; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const run = useAdminMutation(
    (vars: Correction & { reason: string }) =>
      adminRpc(vars.action === 'cancel' ? 'cancel_checkin' : 'reactivate_checkin', {
        p_checkin_id: vars.row.id,
        p_reason: vars.reason,
      }),
    {
      success: correction?.action === 'cancel' ? 'ยกเลิกการลงทะเบียนแล้ว' : 'คืนสถานะการลงทะเบียนแล้ว',
      invalidate: [['history'], ['report'], ['dashboard-stats'], ['member-search']],
    },
  )
  const close = () => {
    setReason('')
    onClose()
  }
  const cancel = correction?.action === 'cancel'

  return (
    <Dialog open={correction !== null} onClose={close} title={cancel ? 'ยกเลิกการลงทะเบียน' : 'คืนสถานะการลงทะเบียน'}>
      {correction && (
        <form
          className="space-y-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault()
            if (reason.trim()) run.mutate({ ...correction, reason: reason.trim() }, { onSuccess: close })
          }}
        >
          <p>
            <span className="font-mono">{correction.row.member_no}</span> {correction.row.full_name} · จุด {correction.row.station_code} ·{' '}
            {formatDateTime(correction.row.checked_in_at)}
          </p>
          {!cancel && <p className="text-muted">ระบบจะคืนรายการเดิม (เวลาและจุดลงทะเบียนเดิม) และบันทึกเหตุผลไว้ในบันทึกการตรวจสอบ</p>}
          <div className="space-y-1">
            <Label htmlFor="corr-reason">เหตุผล (จำเป็น)</Label>
            <textarea
              id="corr-reason"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-20 w-full rounded-lg border border-border bg-surface p-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              ปิด
            </Button>
            <Button type="submit" variant={cancel ? 'danger' : 'default'} disabled={!reason.trim() || run.isPending}>
              {cancel ? 'ยืนยันยกเลิก' : 'ยืนยันคืนสถานะ'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

export function HistoryPage() {
  const { staff, open_event } = useStaffContext()
  const isStaff = staff.role === 'staff'
  const isAdmin = staff.role === 'admin'
  const [correction, setCorrection] = useState<Correction | null>(null)
  const selected = useSelectedEvent()
  // Staff history is scoped server-side to their own check-ins in the open event.
  const event = isStaff ? open_event : selected.event

  const [filters, setFilters] = useState<Filters>({})
  const [offset, setOffset] = useState(0)

  const history = useQuery({
    queryKey: ['history', event?.id, filters, offset],
    queryFn: () => fetchHistory(event!.id, filters, PAGE_SIZE, offset),
    enabled: Boolean(event),
    placeholderData: keepPreviousData,
  })

  function changeFilters(next: Filters) {
    setFilters(next)
    setOffset(0)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">ประวัติการลงทะเบียน</h1>
        {isStaff ? (
          <span className="text-sm text-muted">เฉพาะรายการที่คุณลงทะเบียนในกิจกรรมที่เปิดอยู่</span>
        ) : (
          <EventSelect
            events={selected.events}
            value={event?.id}
            onChange={(id) => {
              selected.setEventId(id)
              setOffset(0)
            }}
          />
        )}
      </div>

      {!event ? (
        <p className="text-muted">{isStaff ? 'ยังไม่มีกิจกรรมที่เปิดลงทะเบียน' : 'ยังไม่มีกิจกรรม'}</p>
      ) : (
        <>
          <FilterBar filters={filters} onChange={changeFilters} showStatus />
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="border-b border-border bg-background text-left text-muted">
                <tr>
                  <th className="px-4 py-2 text-right font-medium">ลำดับ</th>
                  <th className="px-4 py-2 font-medium">เวลา</th>
                  <th className="px-4 py-2 font-medium">เลขสมาชิก</th>
                  <th className="px-4 py-2 font-medium">ชื่อ-สกุล</th>
                  <th className="px-4 py-2 font-medium">ประเภท</th>
                  <th className="px-4 py-2 font-medium">จุด</th>
                  <th className="px-4 py-2 font-medium">เจ้าหน้าที่</th>
                  <th className="px-4 py-2 font-medium">สถานะ</th>
                  {isAdmin && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.isPending ? (
                  <tr>
                    <td colSpan={isAdmin ? 9 : 8} className="px-4 py-6 text-center text-muted">
                      กำลังโหลด…
                    </td>
                  </tr>
                ) : history.isError ? (
                  <tr>
                    <td colSpan={isAdmin ? 9 : 8} className="px-4 py-6 text-center text-danger">
                      โหลดข้อมูลไม่สำเร็จ
                    </td>
                  </tr>
                ) : history.data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 9 : 8} className="px-4 py-6 text-center text-muted">
                      ไม่มีรายการ
                    </td>
                  </tr>
                ) : (
                  history.data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2 text-right tabular-nums">{r.checkin_no}</td>
                      <td className="px-4 py-2 tabular-nums">{formatDateTime(r.checked_in_at)}</td>
                      <td className="px-4 py-2 font-mono">{r.member_no}</td>
                      <td className="px-4 py-2">{r.full_name}</td>
                      <td className="px-4 py-2">{memberTypeLabels[r.member_type]}</td>
                      <td className="px-4 py-2">{r.station_code}</td>
                      <td className="px-4 py-2">{r.staff_name}</td>
                      <td className="px-4 py-2">
                        {r.status === 'active' ? (
                          <span className="text-success">ลงทะเบียนแล้ว</span>
                        ) : (
                          <span className="text-danger" title={r.cancel_reason ?? undefined}>
                            ยกเลิก{r.cancel_reason ? `: ${r.cancel_reason}` : ''}
                          </span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCorrection({ row: r, action: r.status === 'active' ? 'cancel' : 'reactivate' })}
                          >
                            {r.status === 'active' ? 'ยกเลิก' : 'คืนสถานะ'}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
          {history.data && (
            <Pager total={history.data.total} limit={PAGE_SIZE} offset={offset} onOffset={setOffset} />
          )}
          <CorrectionDialog correction={correction} onClose={() => setCorrection(null)} />
        </>
      )}
    </div>
  )
}
