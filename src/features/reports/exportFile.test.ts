import { describe, expect, it } from 'vitest'
import type { ReportRow } from './api'
import { buildCsv, buildXlsx, exportColumns, payoutColumns, toExportRow, toPayoutRow } from './exportFile'

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
    expect(toExportRow(unregistered).slice(4, 8)).toEqual(['ยังไม่ลงทะเบียน', '', '', ''])
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
  }, 20_000) // first exceljs import can exceed the 5 s default on a cold cache
})

describe('payout export', () => {
  const assigned: ReportRow = { ...registered, station_code: '1', assigned_station_code: '1', assigned_station_name: 'สสจ.', payout_seq: 7 }
  const elsewhere: ReportRow = { ...assigned, member_no: '000124', station_code: '3', payout_seq: 8 }
  const absent: ReportRow = { ...unregistered, assigned_station_code: '2', assigned_station_name: 'อ.เมือง', payout_seq: 1 }

  it('puts the payout order first, flags another station and leaves the signature blank', () => {
    expect(toPayoutRow(assigned)[0]).toBe('7')
    expect(toPayoutRow(assigned)[6]).toBe('1')
    expect(toPayoutRow(elsewhere)[6]).toBe('3 (ต่างจุด)')
    expect(toPayoutRow(absent).slice(4, 8)).toEqual(['ยังไม่ลงทะเบียน', '', '', ''])
  })

  it('writes one sheet per assigned station', async () => {
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await buildXlsx([assigned, elsewhere, absent], 'จ่ายค่าตอบแทน', 'payout'))
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['จุด 1', 'จุด 2'])
    const sheet = workbook.worksheets[0]!
    expect(sheet.getRow(2).values).toEqual([undefined, ...payoutColumns.map((c) => c.header)])
    expect(sheet.rowCount).toBe(4)
    expect(sheet.getCell(3, 2).value).toBe('000123')
  }, 20_000)

  it('adds the assigned station as the first CSV column', () => {
    expect(buildCsv([assigned], 'payout').split('\r\n')[1]).toMatch(/^"1","7","000123"/)
  })
})
