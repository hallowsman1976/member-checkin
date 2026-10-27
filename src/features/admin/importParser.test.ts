import { describe, expect, it } from 'vitest'
import { parseCsv, parseImportTable, type RawCell } from './importParser'

const t = (...rows: string[][]): RawCell[][] => rows.map((r) => r.map((text) => ({ text })))

describe('parseCsv', () => {
  it('handles BOM, quotes, escaped quotes, commas and CRLF', () => {
    const rows = parseCsv('﻿a,b\r\n"1,2","say ""hi"""\n')
    expect(rows.map((r) => r.map((c) => c.text))).toEqual([
      ['a', 'b'],
      ['1,2', 'say "hi"'],
    ])
  })
})

describe('parseImportTable', () => {
  it('maps Thai headers and values, keeps leading zeros, normalizes whitespace', () => {
    const parsed = parseImportTable(
      t(
        ['เลขสมาชิก', 'ชื่อ-สกุล', 'หน่วยงาน', 'ประเภทสมาชิก', 'สถานะ'],
        ['000123', ' สมชาย   ใจดี ', 'สสจ.', 'สามัญ', 'ใช้งาน'],
        ['000124', 'สมหญิง รักงาน', '', 'สมทบ', 'พ้นสภาพ'],
        ['', '', '', '', ''],
      ),
    )
    expect(parsed.issues).toEqual([])
    expect(parsed.rows).toEqual([
      { member_no: '000123', full_name: 'สมชาย ใจดี', department: 'สสจ.', member_type: 'ordinary', is_active: true },
      { member_no: '000124', full_name: 'สมหญิง รักงาน', department: null, member_type: 'associate', is_active: false },
    ])
    expect(parsed.lines).toEqual([2, 3])
  })

  it('accepts English headers and omits is_active when the column is absent', () => {
    const parsed = parseImportTable(t(['member_no', 'full_name', 'member_type'], ['1', 'A B', 'ordinary']))
    expect(parsed.rows).toEqual([{ member_no: '1', full_name: 'A B', department: null, member_type: 'ordinary' }])
  })

  it('reports missing required columns', () => {
    const parsed = parseImportTable(t(['เลขสมาชิก', 'ชื่อ-สกุล'], ['1', 'A']))
    expect(parsed.issues).toHaveLength(1)
    expect(parsed.issues[0]!.message).toContain('member_type')
  })

  it('reports per-line problems including duplicates', () => {
    const parsed = parseImportTable(
      t(
        ['member_no', 'full_name', 'member_type'],
        ['1', 'A', 'สามัญ'],
        ['1', 'B', 'สามัญ'],
        ['', 'C', 'สามัญ'],
        ['4', '', 'vip'],
      ),
    )
    expect(parsed.issues.map((i) => i.line)).toEqual([3, 4, 5, 5])
    expect(parsed.issues[0]!.message).toContain('ซ้ำกับแถวที่ 2')
  })

  it('warns when Excel stored member numbers as numbers', () => {
    const parsed = parseImportTable([
      [{ text: 'member_no' }, { text: 'full_name' }, { text: 'member_type' }],
      [{ text: '123', numeric: true }, { text: 'A' }, { text: 'สามัญ' }],
    ])
    expect(parsed.warnings).toHaveLength(1)
  })
})

describe('parseImportTable roster columns', () => {
  const header = ['ลำดับ', 'เลขสมาชิก', 'ชื่อ-นามสกุล', 'หน่วยงาน', 'ประเภทสมาชิก', 'จุดลงทะเบียน', 'หน่วยสมาชิก']

  it('reads station, payout order and member unit from the yearly member file', () => {
    const parsed = parseImportTable(
      t(header, ['1', '00216', 'นายกิตติศักดิ์ ประคองสิน', 'สสจ.มุกดาหาร', 'สามัญ', '1', 'สสจ.มุกดาหาร']),
    )
    expect(parsed.issues).toEqual([])
    expect(parsed.hasRoster).toBe(true)
    expect(parsed.rows).toEqual([
      {
        member_no: '00216',
        full_name: 'นายกิตติศักดิ์ ประคองสิน',
        department: 'สสจ.มุกดาหาร',
        member_type: 'ordinary',
        member_unit: 'สสจ.มุกดาหาร',
        station_code: '1',
        payout_seq: 1,
      },
    ])
  })

  it('allows the same payout order at different stations but not within one', () => {
    const parsed = parseImportTable(
      t(
        header,
        ['1', '00001', 'A', '', 'สามัญ', '1', 'u'],
        ['1', '00002', 'B', '', 'สามัญ', '2', 'u'],
        ['1', '00003', 'C', '', 'สามัญ', '2', 'u'],
        ['x', '00004', 'D', '', 'สามัญ', '2', 'u'],
      ),
    )
    expect(parsed.issues.map((i) => i.line)).toEqual([4, 5])
    expect(parsed.issues[0]!.message).toContain('ซ้ำกับแถวที่ 3')
  })

  it('is not a roster without station or order columns', () => {
    expect(parseImportTable(t(['member_no', 'full_name', 'member_type'], ['1', 'A', 'ordinary'])).hasRoster).toBe(false)
  })
})
