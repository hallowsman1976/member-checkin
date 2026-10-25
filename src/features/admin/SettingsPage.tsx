import { useQuery } from '@tanstack/react-query'
import { Lock, Pencil, Play, Plus, RotateCcw, UserPlus, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { adminRpc, useAdminMutation } from './api'

const eventSchema = z.object({
  id: z.guid(),
  title: z.string(),
  event_date: z.string(),
  status: z.enum(['draft', 'open', 'closed']),
  event_members: z.array(z.object({ count: z.number() })),
})
type EventRow = z.infer<typeof eventSchema>

const statusLabels: Record<EventRow['status'], string> = { draft: 'ร่าง', open: 'เปิดลงทะเบียน', closed: 'ปิดแล้ว' }
const statusClass: Record<EventRow['status'], string> = {
  draft: 'bg-background text-muted',
  open: 'bg-success/10 text-success',
  closed: 'bg-danger/10 text-danger',
}

// Everything that shows event state must refresh after a lifecycle change.
const eventQueries = [['admin-events'], ['events'], ['my-context'], ['dashboard-stats']]

const thaiDate = (d: string) =>
  new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' }).format(new Date(`${d}T00:00:00+07:00`))

function EventDialog({ event, onClose }: { event: EventRow | 'new' | null; onClose: () => void }) {
  const current = event === 'new' ? null : event
  const save = useAdminMutation(
    (vars: { title: string; date: string }) =>
      adminRpc('save_event', { p_event_id: current?.id ?? null, p_title: vars.title, p_event_date: vars.date }),
    { success: 'บันทึกกิจกรรมแล้ว', invalidate: eventQueries },
  )
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    save.mutate({ title: String(form.get('title') ?? ''), date: String(form.get('date') ?? '') }, { onSuccess: onClose })
  }
  return (
    <Dialog open={event !== null} onClose={onClose} title={current ? 'แก้ไขกิจกรรม' : 'สร้างกิจกรรม'}>
      {event !== null && (
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1">
            <Label htmlFor="ev-title">ชื่อกิจกรรม</Label>
            <Input id="ev-title" name="title" defaultValue={current?.title} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-date">วันที่จัด</Label>
            <Input id="ev-date" name="date" type="date" defaultValue={current?.event_date} required />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={save.isPending}>
              บันทึก
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

function EligibilityDialog({ event, onClose }: { event: EventRow | null; onClose: () => void }) {
  const [includeAssociate, setIncludeAssociate] = useState(true)
  const [memberNo, setMemberNo] = useState('')

  const generate = useAdminMutation(
    () => adminRpc('generate_eligibility', { p_event_id: event!.id, p_include_associate: includeAssociate }),
    { invalidate: eventQueries },
  )
  const add = useAdminMutation(
    async (no: string) => {
      const { data, error } = await supabase.from('members').select('id').eq('member_no', no).maybeSingle()
      if (error || !data) {
        toast.error(`ไม่พบสมาชิกเลข ${no}`)
        throw new Error('not found')
      }
      return adminRpc('set_member_eligibility', { p_event_id: event!.id, p_member_id: data.id, p_eligible: true })
    },
    { success: 'เพิ่มผู้มีสิทธิ์แล้ว', invalidate: eventQueries },
  )

  const draft = event?.status === 'draft'
  return (
    <Dialog open={event !== null} onClose={onClose} title={`ผู้มีสิทธิ์: ${event?.title ?? ''}`}>
      {event && (
        <div className="space-y-5 text-sm">
          <p>
            ปัจจุบันมีผู้มีสิทธิ์ <b>{(event.event_members[0]?.count ?? 0).toLocaleString('th-TH')}</b> คน
          </p>

          <section className="space-y-3 rounded-lg border border-border p-4">
            <h3 className="font-semibold">สร้างรายชื่อจากสมาชิกที่ใช้งานอยู่</h3>
            {draft ? (
              <>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={includeAssociate}
                    onChange={(e) => setIncludeAssociate(e.target.checked)}
                    className="size-4 accent-primary"
                  />
                  รวมสมาชิกสมทบ
                </label>
                <p className="text-muted">รายชื่อเดิมของกิจกรรมนี้จะถูกแทนที่ทั้งหมด</p>
                <Button
                  disabled={generate.isPending}
                  onClick={() =>
                    generate.mutate(undefined, {
                      onSuccess: (r) => toast.success(`สร้างรายชื่อผู้มีสิทธิ์ ${Number(r.count).toLocaleString('th-TH')} คน`),
                    })
                  }
                >
                  <Users className="size-4" aria-hidden /> สร้างรายชื่อ
                </Button>
              </>
            ) : (
              <p className="text-muted">รายชื่อถูกล็อกแล้วเมื่อเปิดกิจกรรม (แก้ได้เฉพาะตอนเป็นร่าง)</p>
            )}
          </section>

          {event.status !== 'closed' && (
            <section className="space-y-3 rounded-lg border border-border p-4">
              <h3 className="font-semibold">เพิ่มสมาชิกรายคน</h3>
              <p className="text-muted">ใช้กรณีสมาชิกเข้าใหม่หลังสร้างรายชื่อ (เพิ่มได้ระหว่างเปิดลงทะเบียน)</p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (memberNo.trim()) add.mutate(memberNo.trim(), { onSuccess: () => setMemberNo('') })
                }}
              >
                <Input value={memberNo} onChange={(e) => setMemberNo(e.target.value)} placeholder="เลขสมาชิก" aria-label="เลขสมาชิก" />
                <Button type="submit" variant="outline" disabled={add.isPending}>
                  <UserPlus className="size-4" aria-hidden /> เพิ่ม
                </Button>
              </form>
            </section>
          )}
        </div>
      )}
    </Dialog>
  )
}

export function SettingsPage() {
  const [editing, setEditing] = useState<EventRow | 'new' | null>(null)
  const [eligibilityFor, setEligibilityFor] = useState<EventRow | null>(null)

  const events = useQuery({
    queryKey: ['admin-events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, title, event_date, status, event_members(count)')
        .order('event_date', { ascending: false })
      if (error) throw error
      return z.array(eventSchema).parse(data)
    },
  })

  const setStatus = useAdminMutation(
    (vars: { id: string; status: EventRow['status'] }) => adminRpc('set_event_status', { p_event_id: vars.id, p_status: vars.status }),
    { success: 'เปลี่ยนสถานะกิจกรรมแล้ว', invalidate: eventQueries },
  )

  function changeStatus(event: EventRow, status: EventRow['status'], question: string) {
    if (window.confirm(`${question}\n${event.title}`)) setStatus.mutate({ id: event.id, status })
  }

  // Keep the eligibility dialog showing fresh counts.
  const eligibilityEvent = eligibilityFor ? (events.data?.find((e) => e.id === eligibilityFor.id) ?? eligibilityFor) : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">ตั้งค่ากิจกรรม</h1>
        <Button onClick={() => setEditing('new')}>
          <Plus className="size-4" aria-hidden /> สร้างกิจกรรม
        </Button>
      </div>
      <p className="text-sm text-muted">
        ลำดับ: ร่าง → สร้างรายชื่อผู้มีสิทธิ์ → เปิดลงทะเบียน → ปิด · เปิดได้ครั้งละ 1 กิจกรรม · ทุกการเปลี่ยนแปลงถูกบันทึกในบันทึกการตรวจสอบ
      </p>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="border-b border-border bg-background text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">กิจกรรม</th>
              <th className="px-4 py-2 font-medium">วันที่</th>
              <th className="px-4 py-2 font-medium">สถานะ</th>
              <th className="px-4 py-2 font-medium">ผู้มีสิทธิ์</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {events.data?.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2 font-medium">{e.title}</td>
                <td className="px-4 py-2">{thaiDate(e.event_date)}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass[e.status]}`}>{statusLabels[e.status]}</span>
                </td>
                <td className="px-4 py-2 tabular-nums">{(e.event_members[0]?.count ?? 0).toLocaleString('th-TH')}</td>
                <td className="flex justify-end gap-1 px-4 py-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                    <Pencil className="size-4" aria-hidden /> แก้ไข
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEligibilityFor(e)}>
                    <Users className="size-4" aria-hidden /> ผู้มีสิทธิ์
                  </Button>
                  {e.status === 'draft' && (
                    <Button size="sm" disabled={setStatus.isPending} onClick={() => changeStatus(e, 'open', 'เปิดลงทะเบียนกิจกรรมนี้?')}>
                      <Play className="size-4" aria-hidden /> เปิดลงทะเบียน
                    </Button>
                  )}
                  {e.status === 'open' && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={setStatus.isPending}
                      onClick={() => changeStatus(e, 'closed', 'ปิดการลงทะเบียน? ทุกจุดจะลงทะเบียนต่อไม่ได้')}
                    >
                      <Lock className="size-4" aria-hidden /> ปิด
                    </Button>
                  )}
                  {e.status === 'closed' && (
                    <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => changeStatus(e, 'open', 'เปิดลงทะเบียนอีกครั้ง?')}>
                      <RotateCcw className="size-4" aria-hidden /> เปิดอีกครั้ง
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <EventDialog event={editing} onClose={() => setEditing(null)} />
      <EligibilityDialog event={eligibilityEvent} onClose={() => setEligibilityFor(null)} />
    </div>
  )
}
