// Concurrency tests against local Supabase: `npm run test:integration` (after `npm run db:reset`).
// Each staff account signs in separately, like the 8 notebook stations at the venue.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../../../src/types/database'
import { localConfig, noSession, signIn } from './local'

const EVENT_ID = '30000000-0000-0000-0000-000000000001'

type Client = SupabaseClient<Database>
type RegisterResult = { result: string; code?: string; checkin?: { checkin_no: number; station_code: string; staff_id: string } }

const config = localConfig()
const service: Client = createClient<Database>(config.url, config.serviceKey, noSession)

const stations: Client[] = []
const memberIds = new Map<string, string>()
let admin: Client

async function register(client: Client, memberNo: string) {
  const { data, error } = await client.rpc('register_member', {
    p_event_id: EVENT_ID,
    p_member_id: memberIds.get(memberNo)!,
  })
  if (error) throw error
  return data as RegisterResult
}

async function checkinCount(memberNos: string[]) {
  const ids = memberNos.map((no) => memberIds.get(no)!)
  const { count, error } = await service
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', EVENT_ID)
    .in('member_id', ids)
  if (error) throw error
  return count
}

function tally(results: RegisterResult[]) {
  return results.reduce<Record<string, number>>((acc, r) => {
    const key = r.result === 'error' ? `error:${r.code}` : r.result
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}

const memberNo = (n: number) => String(900000 + n)

beforeAll(async () => {
  for (let i = 1; i <= 8; i++) stations.push(await signIn(`staff${i}@checkin.test`))
  admin = await signIn('admin@checkin.test')

  const { data, error } = await service.from('members').select('id, member_no').like('member_no', '9%')
  if (error) throw error
  for (const m of data) memberIds.set(m.member_no, m.id)
  expect(memberIds.size).toBe(100)
})

beforeEach(async () => {
  const { error } = await service
    .from('checkins')
    .delete()
    .eq('event_id', EVENT_ID)
    .in('member_id', [...memberIds.values()])
  if (error) throw error
})

afterAll(async () => {
  await service.from('events').update({ status: 'open' }).eq('id', EVENT_ID)
  await service.from('checkins').delete().eq('event_id', EVENT_ID).in('member_id', [...memberIds.values()])
})

describe('register_member under concurrency', () => {
  it('same member on 2 stations: exactly one saved check-in', async () => {
    const results = await Promise.all(stations.slice(0, 2).map((s) => register(s, memberNo(1))))
    expect(tally(results)).toEqual({ registered: 1, already_registered: 1 })
    expect(await checkinCount([memberNo(1)])).toBe(1)

    // The loser sees the winner's station.
    const winner = results.find((r) => r.result === 'registered')!
    const loser = results.find((r) => r.result === 'already_registered')!
    expect(loser.checkin?.station_code).toBe(winner.checkin?.station_code)
  })

  it('same member on all 8 stations, 10 rounds: exactly one saved check-in each', async () => {
    for (let round = 1; round <= 10; round++) {
      const no = memberNo(10 + round)
      const results = await Promise.all(stations.map((s) => register(s, no)))
      expect(tally(results)).toEqual({ registered: 1, already_registered: 7 })
      expect(await checkinCount([no])).toBe(1)
    }
  })

  it('8 staff registering different members at once: no lost writes', async () => {
    const perStation = 10
    const jobs = stations.flatMap((s, i) =>
      Array.from({ length: perStation }, (_, j) => ({ station: i + 1, no: memberNo(21 + i * perStation + j) })),
    )
    const results = await Promise.all(jobs.map((job) => register(stations[job.station - 1]!, job.no)))

    expect(tally(results)).toEqual({ registered: jobs.length })
    expect(await checkinCount(jobs.map((j) => j.no))).toBe(jobs.length)
    results.forEach((r, i) => expect(r.checkin?.station_code).toBe(`S0${jobs[i]!.station}`))
    expect(new Set(results.map((r) => r.checkin?.checkin_no)).size).toBe(jobs.length)
  })

  it('repeated requests from one station (double submit): one check-in', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => register(stations[0]!, memberNo(2))))
    expect(tally(results)).toEqual({ registered: 1, already_registered: 4 })
    expect(await checkinCount([memberNo(2)])).toBe(1)
  })

  it('race with event closure: every request is either saved or rejected, never half-done', async () => {
    const nos = Array.from({ length: 40 }, (_, i) => memberNo(3 + i))
    const registrations = nos.map((no, i) => register(stations[i % 8]!, no))
    // The admin closes through the real RPC (FOR UPDATE vs register_member's FOR SHARE).
    const close = admin.rpc('set_event_status', { p_event_id: EVENT_ID, p_status: 'closed' })
    const [results, closeResult] = await Promise.all([Promise.all(registrations), close])
    expect(closeResult.data).toEqual({ ok: true })

    const counts = tally(results)
    expect(Object.keys(counts).every((k) => k === 'registered' || k === 'error:event_not_open')).toBe(true)
    expect(await checkinCount(nos)).toBe(counts.registered ?? 0)

    // After the close commits, nothing more can be registered.
    const after = await register(stations[0]!, memberNo(99))
    expect(after).toMatchObject({ result: 'error', code: 'event_not_open' })

    expect((await admin.rpc('set_event_status', { p_event_id: EVENT_ID, p_status: 'open' })).data).toEqual({ ok: true })
  })
})
