import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { memberTypeLabels } from '@/features/checkin/labels'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { fetchExportRows, fetchReport, type Filters, type ReportFilter } from './api'
import { EventSelect, FilterBar, Pager, useSelectedEvent } from './EventFilters'
import { buildCsv, buildXlsx, downloadBlob, statusLabel } from './exportFile'

const PAGE_SIZE = 100

const reportLabels: Record<ReportFilter, string> = {
  all: 'สมาชิกที่มีสิทธิ์ทั้งหมด',
  registered: 'ลงทะเบียนแล้ว',
  unregistered: 'ยังไม่ลงทะเบียน',
  payout: 'รายชื่อจ่ายค่าตอบแทน',
}

function timestamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}`
}

export function ReportsPage() {
  const { event, events, isPending, setEventId } = useSelectedEvent()
  const [report, setReport] = useState<ReportFilter>('registered')
  const [filters, setFilters] = useState<Filters>({})
  const [offset, setOffset] = useState(0)
  const [exporting, setExporting] = useState<'xlsx' | 'csv' | null>(null)

  // Station/time narrow check-ins, so they only apply to the "registered" list;
  // the payout list filters by assigned station.
  const effectiveFilters: Filters =
    report === 'registered'
      ? filters
      : report === 'payout'
        ? { stationId: filters.stationId, memberType: filters.memberType }
        : { memberType: filters.memberType }
  const kind = report === 'payout' ? 'payout' : 'report'

  const rows = useQuery({
    queryKey: ['report', event?.id, report, effectiveFilters, offset],
    queryFn: () => fetchReport(event!.id, report, effectiveFilters, PAGE_SIZE, offset),
    enabled: Boolean(event),
    placeholderData: keepPreviousData,
  })

  async function exportAs(format: 'xlsx' | 'csv') {
    if (!event || exporting) return
    setExporting(format)
    try {
      const data = await fetchExportRows(event.id, format, report, effectiveFilters)
      const name = `${reportLabels[report]}-${timestamp()}`
      if (format === 'csv') {
        downloadBlob(buildCsv(data, kind), 'text/csv;charset=utf-8', `${name}.csv`)
      } else {
        const buffer = await buildXlsx(
          data,
          kind === 'payout'
            ? `${event.title} — ${reportLabels[report]}`
            : `${event.title} — ${reportLabels[report]} (${data.length.toLocaleString('th-TH')} รายการ)`,
          kind,
        )
        downloadBlob(buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${name}.xlsx`)
      }
      toast.success(`ส่งออก ${data.length.toLocaleString('th-TH')} รายการแล้ว`)
    } catch {
      toast.error('ส่งออกไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setExporting(null)
    }
  }

  if (isPending) return <p className="text-muted">กำลังโหลด…</p>
  if (!event) return <p className="text-muted">ยังไม่มีกิจกรรม</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">รายงาน</h1>
          <EventSelect
            events={events}
            value={event.id}
            onChange={(id) => {
              setEventId(id)
              setOffset(0)
            }}
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={exporting !== null} onClick={() => void exportAs('xlsx')}>
            {exporting === 'xlsx' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="size-4" aria-hidden />}
            ส่งออก Excel
          </Button>
          <Button variant="outline" disabled={exporting !== null} onClick={() => void exportAs('csv')}>
            {exporting === 'csv' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileText className="size-4" aria-hidden />}
            ส่งออก CSV
          </Button>
        </div>
      </div>

      <div role="tablist" aria-label="ประเภทรายงาน" className="inline-flex rounded-lg border border-border bg-surface p-1">
        {(Object.keys(reportLabels) as ReportFilter[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={report === key}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm',
              report === key ? 'bg-primary text-primary-foreground' : 'hover:bg-primary-soft',
            )}
            onClick={() => {
              setReport(key)
              setOffset(0)
            }}
          >
            {reportLabels[key]}
          </button>
        ))}
      </div>

      <FilterBar
        filters={filters}
        onChange={(next) => {
          setFilters(next)
          setOffset(0)
        }}
        checkinFilters={report === 'registered'}
        stationFilter={report === 'registered' || report === 'payout'}
      />
      {report === 'payout' && (
        <p className="text-xs text-muted">
          รายชื่อตามจุดลงทะเบียนที่กำหนดในไฟล์นำเข้า เรียงตามลำดับ · ผู้รับค่าตอบแทนคือผู้ที่สถานะ "ลงทะเบียนแล้ว" · ไฟล์
          Excel แยกชีตตามจุด
        </p>
      )}
      <p className="text-xs text-muted">การส่งออกทุกครั้งถูกบันทึกในบันทึกการตรวจสอบ (PDPA)</p>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[62rem] text-sm">
          <thead className="border-b border-border bg-background text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">เลขสมาชิก</th>
              <th className="px-4 py-2 font-medium">ชื่อ-สกุล</th>
              <th className="px-4 py-2 font-medium">หน่วยงาน</th>
              <th className="px-4 py-2 font-medium">ประเภท</th>
              <th className="px-4 py-2 font-medium">สถานะ</th>
              <th className="px-4 py-2 font-medium">เวลา</th>
              <th className="px-4 py-2 font-medium">จุด</th>
              <th className="px-4 py-2 font-medium">ตามรายชื่อ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.isPending ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-muted">
                  กำลังโหลด…
                </td>
              </tr>
            ) : rows.isError ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-danger">
                  โหลดข้อมูลไม่สำเร็จ
                </td>
              </tr>
            ) : rows.data.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-muted">
                  ไม่มีรายการ
                </td>
              </tr>
            ) : (
              rows.data.rows.map((r) => (
                <tr key={r.member_no}>
                  <td className="px-4 py-2 font-mono">{r.member_no}</td>
                  <td className="px-4 py-2">{r.full_name}</td>
                  <td className="px-4 py-2">{r.department ?? '-'}</td>
                  <td className="px-4 py-2">{memberTypeLabels[r.member_type]}</td>
                  <td className={cn('px-4 py-2', r.is_registered ? 'text-success' : 'text-muted')}>{statusLabel(r)}</td>
                  <td className="px-4 py-2 tabular-nums">{r.checked_in_at ? formatDateTime(r.checked_in_at) : '-'}</td>
                  <td
                    className={cn(
                      'px-4 py-2',
                      r.station_code && r.assigned_station_code && r.station_code !== r.assigned_station_code && 'font-medium text-danger',
                    )}
                  >
                    {r.station_code ?? '-'}
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {r.assigned_station_code ? `จุด ${r.assigned_station_code}${r.payout_seq ? ` · ${r.payout_seq}` : ''}` : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
      {rows.data && <Pager total={rows.data.total} limit={PAGE_SIZE} offset={offset} onOffset={setOffset} />}
    </div>
  )
}
