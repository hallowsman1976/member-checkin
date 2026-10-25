// Venue simulation: 8 stations working concurrently against 1,500 eligible members.
// Run locally with `npm run test:load`; against staging set SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY. Reports p50/p95/max and checks the CLAUDE.md targets.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Database } from '../../../src/types/database'
import { localConfig, noSession, signIn } from '../integration/local'

type Client = SupabaseClient<Database>

const MEMBERS = 1500
const STATIONS = 8
const PER_STATION = 60 // registrations per station in this run (480 total)
const prefix = '8' // synthetic member_no 800001..801500

const config = localConfig()
const service: Client = createClient<Database>(config.url, config.serviceKey, noSession)
let eventId = ''
const memberIds: string[] = []

const memberNo = (i: number) => String(800000 + i)

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!
  return { n: sorted.length, p50: at(50), p95: at(95), max: sorted[sorted.length - 1]! }
}

async function timed<T>(fn: () => PromiseLike<T>) {
  const start = performance.now()
  const value = await fn()
  return { value, ms: performance.now() - start }
}

// Keep `in.(...)` filters short enough for the request URL.
const BATCH = 100

async function countCheckins(ids: string[]) {
  let total = 0
  for (let i = 0; i < ids.length; i += BATCH) {
    const { count, error } = await service
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .in('member_id', ids.slice(i, i + BATCH))
    if (error) throw error
    total += count ?? 0
  }
  return total
}

async function cleanup() {
  // PostgREST caps each response (1,000 rows), so repeat until nothing is left.
  for (;;) {
    const { data } = await service.from('members').select('id').like('member_no', `${prefix}_____`).limit(BATCH)
    const ids = (data ?? []).map((m) => m.id)
    if (ids.length === 0) return
    await service.from('checkins').delete().in('member_id', ids)
    await service.from('event_members').delete().in('member_id', ids)
    const { error } = await service.from('members').delete().in('id', ids)
    if (error) throw error
  }
}

beforeAll(async () => {
  const { data: event } = await service.from('events').select('id').eq('status', 'open').single()
  eventId = event!.id
  await cleanup()

  const rows = Array.from({ length: MEMBERS }, (_, i) => ({
    member_no: memberNo(i + 1),
    full_name: `ทดสอบโหลด ลำดับที่${i + 1}`,
    department: `หน่วยงาน ${(i % 40) + 1}`,
    member_type: i % 10 === 0 ? ('associate' as const) : ('ordinary' as const),
  }))
  for (let i = 0; i < rows.length; i += 500) {
    const { data: inserted, error } = await service
      .from('members')
      .insert(rows.slice(i, i + 500))
      .select('id, member_no')
      .order('member_no')
    if (error) throw error
    memberIds.push(...inserted.map((m) => m.id))
  }
  const { error: eligError } = await service
    .from('event_members')
    .insert(memberIds.map((member_id) => ({ event_id: eventId, member_id })))
  if (eligError) throw eligError
  expect(memberIds).toHaveLength(MEMBERS)
}, 120_000)

afterAll(cleanup, 120_000)

it(
  'meets search/confirm targets with 8 concurrent stations and loses no writes',
  async () => {
    const stations = await Promise.all(Array.from({ length: STATIONS }, (_, i) => signIn(`staff${i + 1}@checkin.test`)))
    const search: number[] = []
    const confirm: number[] = []
    const outcomes: Record<string, number> = {}

    await Promise.all(
      stations.map(async (client, s) => {
        for (let j = 0; j < PER_STATION; j++) {
          const index = s * PER_STATION + j // each station owns its own queue of members
          const byName = j % 3 === 0
          const query = byName ? `ลำดับที่${index + 1}` : memberNo(index + 1)

          const found = await timed(() => client.rpc('search_members', { p_query: query }))
          search.push(found.ms)
          expect(found.value.error).toBeNull()
          const member = found.value.data?.find((m) => m.member_no === memberNo(index + 1))
          expect(member).toBeDefined()

          // Every 10th person also walks up to the next station at the same moment.
          const attempts = [client]
          if (j % 10 === 0) attempts.push(stations[(s + 1) % STATIONS]!)
          const results = await Promise.all(
            attempts.map((c) => timed(() => c.rpc('register_member', { p_event_id: eventId, p_member_id: member!.id }))),
          )
          for (const r of results) {
            confirm.push(r.ms)
            const result = (r.value.data as { result: string } | null)?.result ?? 'transport_error'
            outcomes[result] = (outcomes[result] ?? 0) + 1
          }
        }
      }),
    )

    const total = STATIONS * PER_STATION
    const count = await countCheckins(memberIds.slice(0, total))

    const searchStats = stats(search)
    const confirmStats = stats(confirm)
    console.table({ search: searchStats, confirm: confirmStats })
    console.log('outcomes', outcomes)

    expect(outcomes.registered).toBe(total)
    expect(outcomes.transport_error).toBeUndefined()
    expect(count).toBe(total)
    expect(searchStats.p95).toBeLessThan(1000)
    expect(confirmStats.p95).toBeLessThan(2000)
  },
  300_000,
)
