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
] as const

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
  ]
}

// Neutralize spreadsheet formula injection (=, +, -, @, tab, CR).
function safeCell(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

export function buildCsv(rows: ReportRow[]) {
  const quote = (v: string) => `"${safeCell(v).replaceAll('"', '""')}"`
  const lines = [exportColumns.map((c) => c.header), ...rows.map(toExportRow)].map((cells) => cells.map(quote).join(','))
  // BOM so Excel opens Thai text as UTF-8.
  return `﻿${lines.join('\r\n')}\r\n`
}

export async function buildXlsx(rows: ReportRow[], sheetTitle: string) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('รายงาน', { views: [{ state: 'frozen', ySplit: 2 }] })

  sheet.mergeCells(1, 1, 1, exportColumns.length)
  sheet.getCell(1, 1).value = sheetTitle
  sheet.getCell(1, 1).font = { bold: true, size: 14 }

  const header = sheet.getRow(2)
  exportColumns.forEach((c, i) => {
    header.getCell(i + 1).value = c.header
    sheet.getColumn(i + 1).width = c.width
  })
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1463A5' } }

  sheet.getColumn(1).numFmt = '@'
  // ExcelJS writes plain strings as text cells, never formulas, so no prefixing is needed here.
  for (const row of rows) sheet.addRow(toExportRow(row))
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: exportColumns.length } }

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
