import { z } from 'zod'

export const memberRowSchema = z.object({
  id: z.guid(),
  member_no: z.string(),
  full_name: z.string(),
  department: z.string().nullable(),
  member_type: z.enum(['ordinary', 'associate']),
  is_active: z.boolean(),
  is_eligible: z.boolean(),
  checkin_status: z.enum(['active', 'cancelled']).nullable(),
  checked_in_at: z.string().nullable(),
  station_code: z.string().nullable(),
  station_name: z.string().nullable(),
})
export type MemberRow = z.infer<typeof memberRowSchema>

export const checkinSchema = z.object({
  id: z.guid(),
  status: z.enum(['active', 'cancelled']),
  checked_in_at: z.string(),
  staff_id: z.guid(),
  staff_name: z.string(),
  station_id: z.guid(),
  station_code: z.string(),
  station_name: z.string(),
})
export type Checkin = z.infer<typeof checkinSchema>

export const errorCodes = [
  'not_authenticated',
  'staff_inactive',
  'forbidden',
  'event_not_found',
  'event_not_open',
  'no_station',
  'station_inactive',
  'member_not_found',
  'member_inactive',
  'member_not_eligible',
] as const
export type RegisterErrorCode = (typeof errorCodes)[number] | 'request_rejected' | 'invalid_response'

const errorResultSchema = z.object({ result: z.literal('error'), code: z.string() })

export const registerResultSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('registered'), checkin: checkinSchema }),
  z.object({ result: z.literal('already_registered'), checkin: checkinSchema }),
  z.object({ result: z.literal('cancelled'), checkin: checkinSchema }),
  errorResultSchema,
])

export const statusResultSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('not_registered') }),
  z.object({ result: z.literal('active'), checkin: checkinSchema }),
  z.object({ result: z.literal('cancelled'), checkin: checkinSchema }),
  errorResultSchema,
])

/** What the staff member is told after confirming. */
export type Outcome =
  | { kind: 'registered'; checkin: Checkin; recovered: boolean }
  | { kind: 'already_registered'; checkin: Checkin }
  | { kind: 'cancelled'; checkin: Checkin }
  | { kind: 'error'; code: RegisterErrorCode }
  /** Server confirmed nothing was saved after an unknown outcome; retry is safe. */
  | { kind: 'not_saved' }
  /** Could not confirm either way; retry is blocked until the status is known. */
  | { kind: 'unknown' }

export type RpcResponse = { data: unknown; error: unknown; status: number }

/**
 * A 4xx response is a definite rejection (nothing committed). Anything else that is not a
 * parsed success (network failure, timeout, 5xx, gateway errors) may have committed.
 */
export function isDefiniteRejection(response: RpcResponse) {
  return response.error != null && response.status >= 400 && response.status < 500
}

function toErrorCode(code: string): RegisterErrorCode {
  return (errorCodes as readonly string[]).includes(code) ? (code as RegisterErrorCode) : 'invalid_response'
}

export function outcomeFromRegisterResponse(response: RpcResponse): Outcome | 'unknown' {
  if (response.error) return isDefiniteRejection(response) ? { kind: 'error', code: 'request_rejected' } : 'unknown'
  const parsed = registerResultSchema.safeParse(response.data)
  if (!parsed.success) return 'unknown'
  const r = parsed.data
  switch (r.result) {
    case 'registered':
      return { kind: 'registered', checkin: r.checkin, recovered: false }
    case 'already_registered':
      return { kind: 'already_registered', checkin: r.checkin }
    case 'cancelled':
      return { kind: 'cancelled', checkin: r.checkin }
    case 'error':
      return { kind: 'error', code: toErrorCode(r.code) }
  }
}

/** Resolves an unknown outcome from the authoritative check-in row. */
export function outcomeFromStatusResponse(response: RpcResponse, myStaffId: string): Outcome {
  if (response.error) return { kind: 'unknown' }
  const parsed = statusResultSchema.safeParse(response.data)
  if (!parsed.success) return { kind: 'unknown' }
  const r = parsed.data
  switch (r.result) {
    case 'not_registered':
      return { kind: 'not_saved' }
    case 'active':
      return r.checkin.staff_id === myStaffId
        ? { kind: 'registered', checkin: r.checkin, recovered: true }
        : { kind: 'already_registered', checkin: r.checkin }
    case 'cancelled':
      return { kind: 'cancelled', checkin: r.checkin }
    case 'error':
      return { kind: 'unknown' }
  }
}
