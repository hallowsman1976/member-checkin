export type ImportRow = {
  member_no: string
  full_name: string
  department: string | null
  member_type: string
  is_active?: boolean
  /** Roster columns (หน่วยสมาชิก / จุดลงทะเบียน / ลำดับ), present only when the file has them. */
  member_unit?: string | null
  station_code?: string | null
  payout_seq?: number | null
}

export type ImportIssue = { line: number; message: string }

export type ParsedImport = {
  rows: ImportRow[]
  /** True when the file carries station or payout order, i.e. it is an event roster. */
  hasRoster: boolean
  /** Spreadsheet line number of each row (header is line 1). */
  lines: number[]
  issues: ImportIssue[]
  warnings: string[]
}

/** A cell as read from the file; `numeric` marks Excel number cells (leading zeros already lost). */
export type RawCell = { text: string; numeric?: boolean }

const headerAliases: Record<keyof ImportRow, string[]> = {
  member_no: ['member_no', 'เลขสมาชิก', 'เลขที่สมาชิก', 'รหัสสมาชิก'],
  full_name: ['full_name', 'ชื่อ-สกุล', 'ชื่อ-นามสกุล', 'ชื่อสกุล', 'ชื่อ'],
  department: ['department', 'หน่วยงาน', 'สังกัด'],
  member_type: ['member_type', 'ประเภท', 'ประเภทสมาชิก'],
  is_active: ['is_active', 'สถานะ', 'สถานะสมาชิก'],
  member_unit: ['member_unit', 'หน่วยสมาชิก'],
  station_code: ['station_code', 'จุดลงทะเบียน', 'จุด'],
  payout_seq: ['payout_seq', 'ลำดับ', 'ลำดับที่'],
}

const memberTypeValues: Record<string, 'ordinary' | 'associate'> = {
  ordinary: 'ordinary',
  สามัญ: 'ordinary',
  สมาชิกสามัญ: 'ordinary',
  associate: 'associate',
  สมทบ: 'associate',
  สมาชิกสมทบ: 'associate',
}

const activeValues: Record<string, boolean> = {
  true: true,
  '1': true,
  ใช้งาน: true,
  ปกติ: true,
  false: false,
  '0': false,
  พ้นสภาพ: false,
  ไม่ใช้งาน: false,
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim()
const key = (s: string) => normalize(s).toLowerCase()

export function parseImportTable(table: RawCell[][]): ParsedImport {
  const result: ParsedImport = { rows: [], hasRoster: false, lines: [], issues: [], warnings: [] }
  const [header, ...body] = table
  if (!header) {
    result.issues.push({ line: 1, message: 'ไม่พบหัวตาราง' })
    return result
  }

  const columns = new Map<keyof ImportRow, number>()
  header.forEach((cell, index) => {
    for (const [field, aliases] of Object.entries(headerAliases) as [keyof ImportRow, string[]][]) {
      if (!columns.has(field) && aliases.some((a) => key(a) === key(cell.text))) columns.set(field, index)
    }
  })
  for (const required of ['member_no', 'full_name', 'member_type'] as const) {
    if (!columns.has(required)) {
      result.issues.push({ line: 1, message: `ไม่พบคอลัมน์ ${headerAliases[required][1]} (${required})` })
    }
  }
  if (result.issues.length > 0) return result
  result.hasRoster = columns.has('station_code') || columns.has('payout_seq')

  const cell = (row: RawCell[], field: keyof ImportRow) => {
    const index = columns.get(field)
    return index === undefined ? undefined : row[index]
  }
  const seen = new Map<string, number>()
  const seenSeq = new Map<string, number>()
  let numericMemberNo = false

  body.forEach((row, i) => {
    const line = i + 2
    if (row.every((c) => normalize(c.text) === '')) return

    const memberNoCell = cell(row, 'member_no')
    const memberNo = normalize(memberNoCell?.text ?? '')
    const fullName = normalize(cell(row, 'full_name')?.text ?? '')
    const typeText = normalize(cell(row, 'member_type')?.text ?? '')
    const memberType = memberTypeValues[typeText.toLowerCase()]
    const activeText = cell(row, 'is_active')?.text
    const isActive = activeText !== undefined && normalize(activeText) !== '' ? activeValues[key(activeText)] : undefined

    if (memberNoCell?.numeric) numericMemberNo = true
    if (!memberNo) result.issues.push({ line, message: 'ไม่มีเลขสมาชิก' })
    else if (/\s/.test(memberNo)) result.issues.push({ line, message: `เลขสมาชิก "${memberNo}" มีช่องว่าง` })
    if (!fullName) result.issues.push({ line, message: 'ไม่มีชื่อ-สกุล' })
    if (!memberType) result.issues.push({ line, message: `ประเภทสมาชิก "${typeText}" ไม่ถูกต้อง (สามัญ/สมทบ)` })
    if (activeText !== undefined && normalize(activeText) !== '' && isActive === undefined) {
      result.issues.push({ line, message: `สถานะ "${normalize(activeText)}" ไม่ถูกต้อง (ใช้งาน/พ้นสภาพ)` })
    }
    const memberUnit = normalize(cell(row, 'member_unit')?.text ?? '') || null
    const stationCode = normalize(cell(row, 'station_code')?.text ?? '') || null
    const seqText = normalize(cell(row, 'payout_seq')?.text ?? '')
    const payoutSeq = /^\d{1,9}$/.test(seqText) && Number(seqText) > 0 ? Number(seqText) : null
    if (seqText && payoutSeq === null) result.issues.push({ line, message: `ลำดับ "${seqText}" ไม่ใช่ตัวเลขที่มากกว่า 0` })
    if (payoutSeq !== null) {
      const seqKey = `${stationCode ?? ''}|${payoutSeq}`
      const first = seenSeq.get(seqKey)
      if (first !== undefined) {
        result.issues.push({ line, message: `ลำดับ ${payoutSeq} ของจุด ${stationCode ?? '-'} ซ้ำกับแถวที่ ${first}` })
      } else seenSeq.set(seqKey, line)
    }
    if (memberNo) {
      const first = seen.get(memberNo)
      if (first !== undefined) result.issues.push({ line, message: `เลขสมาชิก ${memberNo} ซ้ำกับแถวที่ ${first}` })
      else seen.set(memberNo, line)
    }

    result.rows.push({
      member_no: memberNo,
      full_name: fullName,
      department: normalize(cell(row, 'department')?.text ?? '') || null,
      member_type: memberType ?? typeText,
      ...(isActive === undefined ? {} : { is_active: isActive }),
      ...(columns.has('member_unit') ? { member_unit: memberUnit } : {}),
      ...(columns.has('station_code') ? { station_code: stationCode } : {}),
      ...(columns.has('payout_seq') ? { payout_seq: payoutSeq } : {}),
    })
    result.lines.push(line)
  })

  if (numericMemberNo) {
    result.warnings.push(
      'คอลัมน์เลขสมาชิกในไฟล์ Excel เป็นตัวเลข เลข 0 นำหน้าอาจหายไป ควรตั้งรูปแบบเซลล์เป็นข้อความ (Text) ก่อนนำเข้า',
    )
  }
  if (result.rows.length === 0) result.issues.push({ line: 2, message: 'ไม่มีข้อมูลสมาชิกในไฟล์' })
  return result
}

/** RFC 4180 CSV (quoted fields, "" escapes, CRLF/LF), UTF-8 BOM stripped. */
export function parseCsv(text: string): RawCell[][] {
  const rows: RawCell[][] = []
  let row: RawCell[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push({ text: field })
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push({ text: field })
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push({ text: field })
    rows.push(row)
  }
  return rows
}

export async function readImportFile(file: File): Promise<RawCell[][]> {
  if (/\.csv$/i.test(file.name)) return parseCsv(await file.text())

  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  const sheet = workbook.worksheets[0]
  if (!sheet) return []
  const table: RawCell[][] = []
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: RawCell[] = []
    for (let c = 1; c <= sheet.columnCount; c++) {
      const value = row.getCell(c).value
      cells.push({ text: value == null ? '' : String(typeof value === 'object' && 'text' in value ? value.text : value), numeric: typeof value === 'number' })
    }
    table.push(cells)
  })
  return table
}
