import { describe, expect, it } from 'vitest'
import type { ReportRow } from './api'
import { buildCsv, buildXlsx, exportColumns, toExportRow } from './exportFile'

const registered: ReportRow = {
  member_no: '000123',
  full_name: 'สมชาย ใจดี',
  department: 'สสจ.มุกดาหาร',
  member_type: 'ordinary',
  is_registered: true,
  checkin_status: 'active',
  checked_in_at: '2026-12-20T02:05:00Z',
  station_code: 'S01',
  station_name: 'จุดลงทะเบียน 1',
  staff_name: 'เจ้าหน้าที่ จุด 1',
}

const unregistered: ReportRow = {
  ...registered,
  member_no: '012345',
  full_name: '=HYPERLINK("x")',
  member_type: 'associate',
  is_registered: false,
  checkin_status: null,
  checked_in_at: null,
  station_code: null,
  station_name: null,
  staff_name: null,
}

describe('toExportRow', () => {
  it('keeps leading zeros and shows Bangkok time in the Buddhist era', () => {
    const row = toExportRow(registered)
    expect(row[0]).toBe('000123')
    expect(row[4]).toBe('ลงทะเบียนแล้ว')
    expect(row[5]).toContain('2569')
    expect(row[5]).toContain('09:05')
    expect(row[6]).toBe('S01 จุดลงทะเบียน 1')
  })

  it('leaves check-in columns empty for unregistered members', () => {
    expect(toExportRow(unregistered).slice(4)).toEqual(['ยังไม่ลงทะเบียน', '', '', ''])
  })
})

describe('buildCsv', () => {
  it('starts with a UTF-8 BOM and a Thai header row', () => {
    const csv = buildCsv([registered])
    expect(csv.startsWith('﻿"เลขสมาชิก","ชื่อ-สกุล"')).toBe(true)
    expect(csv.split('\r\n')).toHaveLength(3)
  })

  it('quotes values and neutralizes formula injection', () => {
    const csv = buildCsv([unregistered])
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('"012345"')
  })
})

describe('buildXlsx', () => {
  it('round-trips every row and keeps member numbers as text', async () => {
    const { default: ExcelJS } = await import('exceljs')
    const rows = [registered, unregistered]
    const buffer = await buildXlsx(rows, 'ทดสอบ')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const sheet = workbook.worksheets[0]!

    expect(sheet.getCell(1, 1).value).toBe('ทดสอบ')
    expect(sheet.getRow(2).values).toEqual([undefined, ...exportColumns.map((c) => c.header)])
    expect(sheet.rowCount).toBe(2 + rows.length)
    expect(sheet.getCell(3, 1).value).toBe('000123')
    expect(sheet.getCell(4, 2).value).toBe('=HYPERLINK("x")')
    expect(sheet.getCell(4, 2).type).toBe(ExcelJS.ValueType.String)
    expect(sheet.getCell(4, 5).value).toBe('ยังไม่ลงทะเบียน')
  })
})
