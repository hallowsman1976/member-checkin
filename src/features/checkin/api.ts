import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import {
  memberRowSchema,
  outcomeFromRegisterResponse,
  outcomeFromStatusResponse,
  type Outcome,
  type RpcResponse,
} from './outcome'
import { normalizeSearchQuery } from './searchQuery'

const REQUEST_TIMEOUT_MS = 10_000

async function callRpc(fn: 'register_member' | 'get_checkin_status', eventId: string, memberId: string) {
  try {
    const { data, error, status } = await supabase
      .rpc(fn, { p_event_id: eventId, p_member_id: memberId })
      .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS))
    return { data, error, status } satisfies RpcResponse
  } catch (error) {
    return { data: null, error, status: 0 } satisfies RpcResponse
  }
}

export function checkStatus(eventId: string, memberId: string, myStaffId: string) {
  return callRpc('get_checkin_status', eventId, memberId).then((r) => outcomeFromStatusResponse(r, myStaffId))
}

/** Registers once; on an unknown outcome asks the server before reporting anything. */
export async function registerMember(eventId: string, memberId: string, myStaffId: string): Promise<Outcome> {
  const outcome = outcomeFromRegisterResponse(await callRpc('register_member', eventId, memberId))
  if (outcome !== 'unknown') return outcome
  return checkStatus(eventId, memberId, myStaffId)
}

export async function searchMembers(query: string, signal: AbortSignal) {
  const { data, error } = await supabase
    .rpc('search_members', { p_query: normalizeSearchQuery(query) })
    .abortSignal(signal)
  if (error) throw error
  return z.array(memberRowSchema).parse(data)
}
