import { useQuery } from '@tanstack/react-query'
import { Radio, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { memberTypeLabels } from '@/features/checkin/labels'
import { fetchDashboardStats } from '@/features/reports/api'
import { EventSelect, useSelectedEvent } from '@/features/reports/EventFilters'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useRealtimeCheckins, type LiveStatus } from './useRealtimeCheckins'

const RECONCILE_INTERVAL_MS = 30_000
const fmt = (n: number) => n.toLocaleString('th-TH')
const percent = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)

function LiveBadge({ status, asOf }: { status: LiveStatus; asOf: string | undefined }) {
  return (
    <span className="flex items-center gap-2 text-sm text-muted">
      {status === 'live' ? (
        <Radio className="size-4 text-success" aria-hidden />
      ) : (
        <WifiOff className="size-4 text-warning" aria-hidden />
      )}
      {status === 'live' ? 'อัปเดตสด' : status === 'connecting' ? 'กำลังเชื่อมต่อ…' : 'ขาดการเชื่อมต่อสด (ดึงข้อมูลทุก 30 วินาที)'}
      {asOf && <span>· ข้อมูล ณ {formatTime(asOf)}</span>}
    </span>
  )
}

function StatTile({ label, value, sub, emphasis }: { label: string; value: string; sub?: ReactNode; emphasis?: boolean }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className={cn('mt-1 font-semibold tabular-nums', emphasis ? 'text-5xl text-primary' : 'text-4xl')}>{value}</p>
      {sub && <div className="mt-2 text-sm text-muted">{sub}</div>}
    </Card>
  )
}

/** Single-hue horizontal meter; the value is always printed as text beside it. */
function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div
      className="h-3 w-full overflow-hidden rounded-full bg-primary-soft"
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      title={label}
    >
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent(value, max)}%` }} />
    </div>
  )
}

export function DashboardPage() {
  const { event, events, isPending, setEventId } = useSelectedEvent()
  const queryKey = ['dashboard-stats', event?.id] as const

  const stats = useQuery({
    queryKey,
    queryFn: () => fetchDashboardStats(event!.id),
    enabled: Boolean(event),
    refetchInterval: RECONCILE_INTERVAL_MS,
    refetchOnReconnect: 'always',
  })
  const live = useRealtimeCheckins(event?.status === 'open' ? event.id : undefined, queryKey)

  if (isPending) return <p className="text-muted">กำลังโหลด…</p>
  if (!event) return <p className="text-muted">ยังไม่มีกิจกรรม</p>

  const s = stats.data
  const maxStation = Math.max(1, ...(s?.by_station.map((x) => x.registered) ?? []))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">แดชบอร์ด</h1>
          <EventSelect events={events} value={event.id} onChange={setEventId} />
        </div>
        {event.status === 'open' && <LiveBadge status={live} asOf={s?.as_of} />}
      </div>

      {stats.isError && <p className="text-danger">โหลดข้อมูลไม่สำเร็จ กำลังลองใหม่อัตโนมัติ</p>}

      {!s ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="ลงทะเบียนแล้ว"
              value={fmt(s.registered)}
              emphasis
              sub={s.cancelled > 0 ? `ยกเลิก ${fmt(s.cancelled)} รายการ (ไม่นับรวม)` : undefined}
            />
            <StatTile label="สมาชิกที่มีสิทธิ์" value={fmt(s.eligible)} />
            <StatTile label="ยังไม่ลงทะเบียน" value={fmt(s.remaining)} />
            <StatTile
              label="ความคืบหน้า"
              value={`${percent(s.registered, s.eligible).toFixed(1)}%`}
              sub={<Meter value={s.registered} max={s.eligible} label="ความคืบหน้าการลงทะเบียน" />}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>จำนวนลงทะเบียนตามจุด</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {s.by_station.map((st) => (
                    <li key={st.station_id} className="grid grid-cols-[9rem_1fr_3.5rem] items-center gap-3 text-sm">
                      <span className="truncate" title={st.station_name}>
                        <span className="font-medium">{st.station_code}</span> {st.station_name}
                      </span>
                      <Meter value={st.registered} max={maxStation} label={`${st.station_code}: ${fmt(st.registered)} คน`} />
                      <span className="text-right font-medium tabular-nums">{fmt(st.registered)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>ตามประเภทสมาชิก</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {s.by_member_type.map((t) => (
                  <div key={t.member_type} className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span>{memberTypeLabels[t.member_type]}</span>
                      <span className="tabular-nums">
                        <span className="font-medium">{fmt(t.registered)}</span> / {fmt(t.eligible)}
                      </span>
                    </div>
                    <Meter
                      value={t.registered}
                      max={t.eligible}
                      label={`${memberTypeLabels[t.member_type]}: ${fmt(t.registered)} จาก ${fmt(t.eligible)}`}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>ลงทะเบียนล่าสุด</CardTitle>
            </CardHeader>
            <CardContent>
              {s.recent.length === 0 ? (
                <p className="text-sm text-muted">ยังไม่มีการลงทะเบียน</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="py-1 font-normal">เวลา</th>
                      <th className="py-1 font-normal">เลขสมาชิก</th>
                      <th className="py-1 font-normal">ชื่อ-สกุล</th>
                      <th className="py-1 font-normal">จุด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {s.recent.map((r) => (
                      <tr key={`${r.member_no}-${r.checked_in_at}`}>
                        <td className="py-1.5 tabular-nums">{formatTime(r.checked_in_at)}</td>
                        <td className="py-1.5 font-mono">{r.member_no}</td>
                        <td className="py-1.5">{r.full_name}</td>
                        <td className="py-1.5">{r.station_code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
