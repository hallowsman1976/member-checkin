import { formatDateTime } from '@/lib/format'
import { memberTypeLabels } from '@/features/checkin/labels'
import type { ReportRow } from './api'

export const exportColumns = [
  { header: 'เลขสมาชิก', width: 12 },
  { header: 'ชื่อ-สกุล', width: 30 },
  { header: 'หน่วยงาน', width: 28 },
  { header: 'ประเภทสมาชิก', width: 14 },
  { header: 'สถานะ', width: 16 },
  { header: 'เวลาลงทะเบียน', width: 22 },
  { header: 'จุดลงทะเบียน', width: 20 },
  { header: 'เจ้าหน้าที่', width: 22 },
  { header: 'หน่วยสมาชิก', width: 20 },
  { header: 'จุดตามรายชื่อ', width: 14 },
  { header: 'ลำดับ', width: 8 },
] as const

/** Payout form (แบบฟอร์มจ่ายค่าตอบแทนร่วมประชุม): one sheet per assigned station, in payout order. */
export const payoutColumns = [
  { header: 'ลำดับ', width: 8 },
  { header: 'เลขสมาชิก', width: 12 },
  { header: 'ชื่อ-สกุล', width: 30 },
  { header: 'หน่วยงาน', width: 24 },
  { header: 'สถานะ', width: 16 },
  { header: 'เวลาลงทะเบียน', width: 22 },
  { header: 'ลงทะเบียนที่จุด', width: 18 },
  { header: 'ลายมือชื่อ', width: 24 },
] as const

export type ExportKind = 'report' | 'payout'
type Column = { header: string; width: number }

export function statusLabel(row: Pick<ReportRow, 'checkin_status'>) {
  if (row.checkin_status === 'active') return 'ลงทะเบียนแล้ว'
  if (row.checkin_status === 'cancelled') return 'ถูกยกเลิก'
  return 'ยังไม่ลงทะเบียน'
}

/** One output row per member; member_no stays text so leading zeros survive. */
export function toExportRow(row: ReportRow): string[] {
  return [
    row.member_no,
    row.full_name,
    row.department ?? '',
    memberTypeLabels[row.member_type],
    statusLabel(row),
    row.checked_in_at ? formatDateTime(row.checked_in_at) : '',
    row.station_code ? `${row.station_code} ${row.station_name ?? ''}`.trim() : '',
    row.staff_name ?? '',
    row.member_unit ?? '',
    row.assigned_station_code ?? '',
    row.payout_seq?.toString() ?? '',
  ]
}

/** Actual check-in station, flagged when it differs from the assigned one. */
function actualStation(row: ReportRow) {
  if (!row.station_code) return ''
  return row.assigned_station_code && row.station_code !== row.assigned_station_code
    ? `${row.station_code} (ต่างจุด)`
    : row.station_code
}

export function toPayoutRow(row: ReportRow): string[] {
  return [
    row.payout_seq?.toString() ?? '',
    row.member_no,
    row.full_name,
    row.department ?? '',
    statusLabel(row),
    row.checked_in_at ? formatDateTime(row.checked_in_at) : '',
    actualStation(row),
    '',
  ]
}

const layouts: Record<ExportKind, { columns: readonly Column[]; toRow: (row: ReportRow) => string[] }> = {
  report: { columns: exportColumns, toRow: toExportRow },
  payout: { columns: payoutColumns, toRow: toPayoutRow },
}

// Neutralize spreadsheet formula injection (=, +, -, @, tab, CR).
function safeCell(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

export function buildCsv(rows: ReportRow[], kind: ExportKind = 'report') {
  const { columns, toRow } = layouts[kind]
  const quote = (v: string) => `"${safeCell(v).replaceAll('"', '""')}"`
  // The payout CSV is one file for all stations, so it leads with the assigned station.
  const head = kind === 'payout' ? ['จุดตามรายชื่อ', ...columns.map((c) => c.header)] : columns.map((c) => c.header)
  const body = rows.map((r) => (kind === 'payout' ? [r.assigned_station_code ?? '', ...toRow(r)] : toRow(r)))
  const lines = [head, ...body].map((cells) => cells.map(quote).join(','))
  // BOM so Excel opens Thai text as UTF-8.
  return `﻿${lines.join('\r\n')}\r\n`
}

export async function buildXlsx(rows: ReportRow[], sheetTitle: string, kind: ExportKind = 'report') {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const { columns, toRow } = layouts[kind]

  function addSheet(name: string, title: string, sheetRows: ReportRow[]) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 2 }] })
    sheet.mergeCells(1, 1, 1, columns.length)
    sheet.getCell(1, 1).value = title
    sheet.getCell(1, 1).font = { bold: true, size: 14 }

    const header = sheet.getRow(2)
    columns.forEach((c, i) => {
      header.getCell(i + 1).value = c.header
      sheet.getColumn(i + 1).width = c.width
    })
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1463A5' } }

    sheet.getColumn(columns.findIndex((c) => c.header === 'เลขสมาชิก') + 1).numFmt = '@'
    // ExcelJS writes plain strings as text cells, never formulas, so no prefixing is needed here.
    for (const row of sheetRows) sheet.addRow(toRow(row))
    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: columns.length } }
  }

  if (kind === 'payout') {
    // Rows arrive in payout order (assigned station, then ลำดับ), so each group keeps that order.
    const groups = new Map<string, ReportRow[]>()
    for (const row of rows) {
      const code = row.assigned_station_code ?? ''
      groups.set(code, [...(groups.get(code) ?? []), row])
    }
    for (const [code, group] of groups) {
      const label = code ? `จุด ${code}` : 'ไม่ระบุจุด'
      const name = group[0]?.assigned_station_name
      addSheet(label.slice(0, 31), `${sheetTitle} — ${label}${name ? ` ${name}` : ''} (${group.length} คน)`, group)
    }
    if (groups.size === 0) addSheet('รายงาน', sheetTitle, [])
  } else {
    addSheet('รายงาน', sheetTitle, rows)
  }

  return workbook.xlsx.writeBuffer()
}

export function downloadBlob(data: BlobPart, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
