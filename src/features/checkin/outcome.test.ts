import { describe, expect, it } from 'vitest'
import { outcomeFromRegisterResponse, outcomeFromStatusResponse, type Checkin } from './outcome'

const me = '10000000-0000-0000-0000-000000000003'
const checkin: Checkin = {
  id: '40000000-0000-0000-0000-000000000001',
  status: 'active',
  checked_in_at: '2026-12-20T02:00:00Z',
  staff_id: me,
  staff_name: 'เจ้าหน้าที่ จุด 1',
  station_id: '20000000-0000-0000-0000-000000000001',
  station_code: 'S01',
  station_name: 'จุดลงทะเบียน 1',
}

describe('outcomeFromRegisterResponse', () => {
  it('maps a registered result', () => {
    expect(outcomeFromRegisterResponse({ data: { result: 'registered', checkin }, error: null, status: 200 })).toEqual({
      kind: 'registered',
      checkin,
      recovered: false,
    })
  })

  it('maps already_registered and cancelled', () => {
    const other = { ...checkin, staff_id: '10000000-0000-0000-0000-000000000004' }
    expect(
      outcomeFromRegisterResponse({ data: { result: 'already_registered', checkin: other }, error: null, status: 200 }),
    ).toEqual({ kind: 'already_registered', checkin: other })
    expect(
      outcomeFromRegisterResponse({
        data: { result: 'cancelled', checkin: { ...checkin, status: 'cancelled' } },
        error: null,
        status: 200,
      }),
    ).toMatchObject({ kind: 'cancelled' })
  })

  it('maps known and unknown server error codes', () => {
    expect(
      outcomeFromRegisterResponse({ data: { result: 'error', code: 'event_not_open' }, error: null, status: 200 }),
    ).toEqual({ kind: 'error', code: 'event_not_open' })
    expect(
      outcomeFromRegisterResponse({ data: { result: 'error', code: 'something_new' }, error: null, status: 200 }),
    ).toEqual({ kind: 'error', code: 'invalid_response' })
  })

  it('treats network failures, timeouts and 5xx as unknown', () => {
    expect(outcomeFromRegisterResponse({ data: null, error: new TypeError('Failed to fetch'), status: 0 })).toBe('unknown')
    expect(outcomeFromRegisterResponse({ data: null, error: { message: 'timeout' }, status: 504 })).toBe('unknown')
    expect(outcomeFromRegisterResponse({ data: null, error: { message: 'boom' }, status: 500 })).toBe('unknown')
  })

  it('treats a 4xx as a definite rejection', () => {
    expect(outcomeFromRegisterResponse({ data: null, error: { message: 'JWT expired' }, status: 401 })).toEqual({
      kind: 'error',
      code: 'request_rejected',
    })
  })

  it('never reports success for a malformed body', () => {
    expect(outcomeFromRegisterResponse({ data: { result: 'registered' }, error: null, status: 200 })).toBe('unknown')
  })
})

describe('outcomeFromStatusResponse', () => {
  it('recovers my own committed registration as success', () => {
    expect(outcomeFromStatusResponse({ data: { result: 'active', checkin }, error: null, status: 200 }, me)).toEqual({
      kind: 'registered',
      checkin,
      recovered: true,
    })
  })

  it('reports another station’s registration as already registered', () => {
    const other = { ...checkin, staff_id: '10000000-0000-0000-0000-000000000004' }
    expect(
      outcomeFromStatusResponse({ data: { result: 'active', checkin: other }, error: null, status: 200 }, me),
    ).toEqual({ kind: 'already_registered', checkin: other })
  })

  it('allows a retry only when the server confirms nothing was saved', () => {
    expect(outcomeFromStatusResponse({ data: { result: 'not_registered' }, error: null, status: 200 }, me)).toEqual({
      kind: 'not_saved',
    })
    expect(outcomeFromStatusResponse({ data: null, error: new TypeError('Failed to fetch'), status: 0 }, me)).toEqual({
      kind: 'unknown',
    })
  })
})
