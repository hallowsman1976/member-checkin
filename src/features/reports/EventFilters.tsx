import { useSearchParams } from 'react-router'
import { Label } from '@/components/ui/label'
import { memberTypeLabels } from '@/features/checkin/labels'
import { cn } from '@/lib/utils'
import { useEvents, useStations, type EventRow, type Filters } from './api'

export const selectClass =
  'h-10 rounded-lg border border-border bg-surface px-3 text-sm disabled:opacity-50'

const eventStatusLabels: Record<EventRow['status'], string> = { draft: 'ร่าง', open: 'เปิดอยู่', closed: 'ปิดแล้ว' }

/** Selected event lives in `?event=`; defaults to the open event, else the latest. */
export function useSelectedEvent() {
  const [params, setParams] = useSearchParams()
  const events = useEvents()
  const list = events.data ?? []
  const fromUrl = list.find((e) => e.id === params.get('event'))
  const event = fromUrl ?? list.find((e) => e.status === 'open') ?? list[0] ?? null

  function setEventId(id: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('event', id)
        return next
      },
      { replace: true },
    )
  }

  return { event, events: list, isPending: events.isPending, setEventId }
}

export function EventSelect({
  events,
  value,
  onChange,
}: {
  events: EventRow[]
  value: string | undefined
  onChange: (id: string) => void
}) {
  return (
    <select aria-label="กิจกรรม" className={cn(selectClass, 'min-w-64')} value={value} onChange={(e) => onChange(e.target.value)}>
      {events.map((e) => (
        <option key={e.id} value={e.id}>
          {e.title} ({eventStatusLabels[e.status]})
        </option>
      ))}
    </select>
  )
}

// <input type="datetime-local"> values are wall-clock Bangkok time.
const toIso = (local: string) => (local ? `${local}:00+07:00` : undefined)
const toLocal = (iso: string | undefined) => (iso ? iso.slice(0, 16) : '')

/** Station / member type / time filters. `checkinFilters` disables the check-in-only fields. */
export function FilterBar({
  filters,
  onChange,
  showStatus = false,
  checkinFilters = true,
  stationFilter = checkinFilters,
}: {
  filters: Filters
  onChange: (filters: Filters) => void
  showStatus?: boolean
  checkinFilters?: boolean
  /** Station filter on its own (the payout list filters by assigned station). */
  stationFilter?: boolean
}) {
  const stations = useStations()
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="f-station">จุดลงทะเบียน</Label>
        <select
          id="f-station"
          className={cn(selectClass, 'block')}
          disabled={!stationFilter}
          value={filters.stationId ?? ''}
          onChange={(e) => set({ stationId: e.target.value || undefined })}
        >
          <option value="">ทุกจุด</option>
          {stations.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.station_code} {s.station_name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="f-type">ประเภทสมาชิก</Label>
        <select
          id="f-type"
          className={cn(selectClass, 'block')}
          value={filters.memberType ?? ''}
          onChange={(e) => set({ memberType: (e.target.value || undefined) as Filters['memberType'] })}
        >
          <option value="">ทุกประเภท</option>
          {Object.entries(memberTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {showStatus && (
        <div className="space-y-1">
          <Label htmlFor="f-status">สถานะ</Label>
          <select
            id="f-status"
            className={cn(selectClass, 'block')}
            value={filters.status ?? ''}
            onChange={(e) => set({ status: (e.target.value || undefined) as Filters['status'] })}
          >
            <option value="">ทั้งหมด</option>
            <option value="active">ลงทะเบียนแล้ว</option>
            <option value="cancelled">ถูกยกเลิก</option>
          </select>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="f-from">ตั้งแต่</Label>
        <input
          id="f-from"
          type="datetime-local"
          className={cn(selectClass, 'block')}
          disabled={!checkinFilters}
          value={toLocal(filters.from)}
          onChange={(e) => set({ from: toIso(e.target.value) })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="f-to">ถึงก่อน</Label>
        <input
          id="f-to"
          type="datetime-local"
          className={cn(selectClass, 'block')}
          disabled={!checkinFilters}
          value={toLocal(filters.to)}
          onChange={(e) => set({ to: toIso(e.target.value) })}
        />
      </div>
    </div>
  )
}

export function Pager({
  total,
  limit,
  offset,
  onOffset,
}: {
  total: number
  limit: number
  offset: number
  onOffset: (offset: number) => void
}) {
  const page = Math.floor(offset / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-muted">
      <span>ทั้งหมด {total.toLocaleString('th-TH')} รายการ</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onOffset(offset - limit)}
        >
          ก่อนหน้า
        </button>
        <span>
          หน้า {page} / {pages}
        </span>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
          disabled={page >= pages}
          onClick={() => onOffset(offset + limit)}
        >
          ถัดไป
        </button>
      </div>
    </div>
  )
}
