import { useQuery } from '@tanstack/react-query'
import { KeyRound, Pencil, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { staffRoles, type StaffRole } from '@/features/auth/access'
import { useStaffContext } from '@/features/auth/StaffContext'
import { EventSelect, selectClass, useSelectedEvent } from '@/features/reports/EventFilters'
import { supabase } from '@/lib/supabase'
import { adminRpc, adminStaffFunction, useAdminMutation } from './api'

const roleLabels: Record<StaffRole, string> = { admin: 'ผู้ดูแลระบบ', supervisor: 'หัวหน้างาน', staff: 'เจ้าหน้าที่' }

const staffSchema = z.object({
  id: z.guid(),
  email: z.string(),
  full_name: z.string(),
  role: z.enum(staffRoles),
  is_active: z.boolean(),
})
type Staff = z.infer<typeof staffSchema>

const stationSchema = z.object({ id: z.guid(), station_code: z.string(), station_name: z.string(), is_active: z.boolean() })
type Station = z.infer<typeof stationSchema>

const assignmentSchema = z.object({ staff_id: z.guid(), station_id: z.guid() })

function useStaffList() {
  return useQuery({
    queryKey: ['admin-staff'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_staff')
      if (error) throw error
      return z.array(staffSchema).parse(data)
    },
  })
}

function useAllStations() {
  return useQuery({
    queryKey: ['admin-stations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stations').select('id, station_code, station_name, is_active').order('station_code')
      if (error) throw error
      return z.array(stationSchema).parse(data)
    },
  })
}

const formValue = (form: FormData, name: string) => String(form.get(name) ?? '').trim()

function CreateStaffDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useAdminMutation((body: Record<string, unknown>) => adminStaffFunction({ action: 'create', ...body }), {
    success: 'สร้างบัญชีแล้ว',
    invalidate: [['admin-staff']],
  })

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    create.mutate(
      {
        email: formValue(form, 'email'),
        password: String(form.get('password') ?? ''),
        full_name: formValue(form, 'full_name'),
        role: formValue(form, 'role'),
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Dialog open={open} onClose={onClose} title="สร้างบัญชีเจ้าหน้าที่">
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1">
          <Label htmlFor="cs-name">ชื่อ-สกุล</Label>
          <Input id="cs-name" name="full_name" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cs-email">อีเมล (ใช้เข้าสู่ระบบ)</Label>
          <Input id="cs-email" name="email" type="email" required autoComplete="off" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cs-password">รหัสผ่านเริ่มต้น (อย่างน้อย 8 ตัว มีตัวอักษรและตัวเลข)</Label>
          <Input id="cs-password" name="password" type="password" minLength={8} required autoComplete="new-password" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cs-role">บทบาท</Label>
          <select id="cs-role" name="role" className={`${selectClass} block w-full`} defaultValue="staff">
            {staffRoles.map((r) => (
              <option key={r} value={r}>
                {roleLabels[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={create.isPending}>
            สร้างบัญชี
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function EditStaffDialog({ staff, onClose }: { staff: Staff | null; onClose: () => void }) {
  const update = useAdminMutation(
    (vars: { full_name: string; role: string; is_active: boolean }) =>
      adminRpc('update_staff', { p_staff_id: staff!.id, p_full_name: vars.full_name, p_role: vars.role, p_is_active: vars.is_active }),
    { success: 'บันทึกแล้ว', invalidate: [['admin-staff']] },
  )

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    update.mutate(
      { full_name: formValue(form, 'full_name'), role: formValue(form, 'role'), is_active: form.get('is_active') === 'on' },
      { onSuccess: onClose },
    )
  }

  return (
    <Dialog open={staff !== null} onClose={onClose} title={`แก้ไขบัญชี ${staff?.email ?? ''}`}>
      {staff && (
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1">
            <Label htmlFor="es-name">ชื่อ-สกุล</Label>
            <Input id="es-name" name="full_name" defaultValue={staff.full_name} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="es-role">บทบาท</Label>
            <select id="es-role" name="role" className={`${selectClass} block w-full`} defaultValue={staff.role}>
              {staffRoles.map((r) => (
                <option key={r} value={r}>
                  {roleLabels[r]}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="is_active" defaultChecked={staff.is_active} className="size-4 accent-primary" />
            เปิดใช้งานบัญชี
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={update.isPending}>
              บันทึก
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

function ResetPasswordDialog({ staff, onClose }: { staff: Staff | null; onClose: () => void }) {
  const reset = useAdminMutation(
    (password: string) => adminStaffFunction({ action: 'reset_password', staff_id: staff!.id, password }),
    { success: 'ตั้งรหัสผ่านใหม่แล้ว' },
  )
  return (
    <Dialog open={staff !== null} onClose={onClose} title={`ตั้งรหัสผ่านใหม่: ${staff?.full_name ?? ''}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          reset.mutate(String(new FormData(e.currentTarget).get('password') ?? ''), { onSuccess: onClose })
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="rp-password">รหัสผ่านใหม่ (อย่างน้อย 8 ตัว มีตัวอักษรและตัวเลข)</Label>
          <Input id="rp-password" name="password" type="password" minLength={8} required autoComplete="new-password" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={reset.isPending}>
            บันทึก
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function StationDialog({ station, onClose }: { station: Station | 'new' | null; onClose: () => void }) {
  const current = station === 'new' ? null : station
  const save = useAdminMutation(
    (vars: { code: string; name: string; active: boolean }) =>
      adminRpc('save_station', {
        p_station_id: current?.id ?? null,
        p_station_code: vars.code,
        p_station_name: vars.name,
        p_is_active: vars.active,
      }),
    { success: 'บันทึกจุดลงทะเบียนแล้ว', invalidate: [['admin-stations'], ['stations']] },
  )
  return (
    <Dialog open={station !== null} onClose={onClose} title={current ? `แก้ไขจุด ${current.station_code}` : 'เพิ่มจุดลงทะเบียน'}>
      {station !== null && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            const form = new FormData(e.currentTarget)
            save.mutate(
              { code: formValue(form, 'code'), name: formValue(form, 'name'), active: form.get('active') === 'on' },
              { onSuccess: onClose },
            )
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="st-code">รหัสจุด</Label>
            <Input id="st-code" name="code" defaultValue={current?.station_code} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="st-name">ชื่อจุด</Label>
            <Input id="st-name" name="name" defaultValue={current?.station_name} required />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={current?.is_active ?? true} className="size-4 accent-primary" />
            เปิดใช้งาน
          </label>
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

function Assignments({ staff, stations }: { staff: Staff[]; stations: Station[] }) {
  const { event, events, setEventId } = useSelectedEvent()
  const assignments = useQuery({
    queryKey: ['assignments', event?.id],
    enabled: Boolean(event),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_station_assignments')
        .select('staff_id, station_id')
        .eq('event_id', event!.id)
        .eq('is_active', true)
      if (error) throw error
      return new Map(z.array(assignmentSchema).parse(data).map((a) => [a.staff_id, a.station_id]))
    },
  })
  const assign = useAdminMutation(
    (vars: { staffId: string; stationId: string | null }) =>
      adminRpc('assign_station', { p_event_id: event!.id, p_staff_id: vars.staffId, p_station_id: vars.stationId }),
    { success: 'บันทึกการมอบหมายแล้ว', invalidate: [['assignments'], ['my-context']] },
  )
  const eligible = staff.filter((s) => s.is_active && s.role !== 'supervisor')

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>มอบหมายจุดลงทะเบียน</CardTitle>
        {event && <EventSelect events={events} value={event.id} onChange={setEventId} />}
      </CardHeader>
      <CardContent>
        {!event ? (
          <p className="text-muted">ยังไม่มีกิจกรรม</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {eligible.map((s) => (
                <tr key={s.id}>
                  <td className="py-2">
                    {s.full_name} <span className="text-muted">({roleLabels[s.role]})</span>
                  </td>
                  <td className="py-2 text-right">
                    <select
                      aria-label={`จุดลงทะเบียนของ ${s.full_name}`}
                      className={selectClass}
                      disabled={assign.isPending || event.status === 'closed'}
                      value={assignments.data?.get(s.id) ?? ''}
                      onChange={(e) => assign.mutate({ staffId: s.id, stationId: e.target.value || null })}
                    >
                      <option value="">— ไม่ได้มอบหมาย —</option>
                      {stations
                        .filter((st) => st.is_active)
                        .map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.station_code} {st.station_name}
                          </option>
                        ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

export function StaffPage() {
  const { staff: me } = useStaffContext()
  const staff = useStaffList()
  const stations = useAllStations()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Staff | null>(null)
  const [resetting, setResetting] = useState<Staff | null>(null)
  const [stationEdit, setStationEdit] = useState<Station | 'new' | null>(null)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">เจ้าหน้าที่และจุดลงทะเบียน</h1>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>บัญชีเจ้าหน้าที่</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> สร้างบัญชี
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-2 font-medium">ชื่อ-สกุล</th>
                <th className="py-2 font-medium">อีเมล</th>
                <th className="py-2 font-medium">บทบาท</th>
                <th className="py-2 font-medium">สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {staff.data?.map((s) => (
                <tr key={s.id}>
                  <td className="py-2">
                    {s.full_name}
                    {s.id === me.id && <span className="ml-1 text-xs text-muted">(คุณ)</span>}
                  </td>
                  <td className="py-2">{s.email}</td>
                  <td className="py-2">{roleLabels[s.role]}</td>
                  <td className="py-2">{s.is_active ? <span className="text-success">ใช้งาน</span> : <span className="text-danger">ปิดใช้งาน</span>}</td>
                  <td className="py-2 text-right">
                    <Button size="icon" variant="ghost" aria-label={`แก้ไข ${s.full_name}`} onClick={() => setEditing(s)}>
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`ตั้งรหัสผ่านใหม่ ${s.full_name}`} onClick={() => setResetting(s)}>
                      <KeyRound className="size-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Assignments staff={staff.data ?? []} stations={stations.data ?? []} />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>จุดลงทะเบียน</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setStationEdit('new')}>
              <Plus className="size-4" aria-hidden /> เพิ่มจุด
            </Button>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {stations.data?.map((st) => (
                  <tr key={st.id}>
                    <td className="py-2 font-medium">{st.station_code}</td>
                    <td className="py-2">{st.station_name}</td>
                    <td className="py-2">{st.is_active ? <span className="text-success">ใช้งาน</span> : <span className="text-danger">ปิด</span>}</td>
                    <td className="py-2 text-right">
                      <Button size="icon" variant="ghost" aria-label={`แก้ไขจุด ${st.station_code}`} onClick={() => setStationEdit(st)}>
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <CreateStaffDialog open={creating} onClose={() => setCreating(false)} />
      <EditStaffDialog staff={editing} onClose={() => setEditing(null)} />
      <ResetPasswordDialog staff={resetting} onClose={() => setResetting(null)} />
      <StationDialog station={stationEdit} onClose={() => setStationEdit(null)} />
    </div>
  )
}
