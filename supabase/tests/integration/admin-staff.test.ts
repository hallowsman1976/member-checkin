// Edge Function `admin-staff` against local Supabase: `npm run test:integration`.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '../../../src/types/database'
import { localConfig, noSession, PASSWORD, signIn } from './local'

type Client = SupabaseClient<Database>

const config = localConfig()
const service: Client = createClient<Database>(config.url, config.serviceKey, noSession)
const email = `new-staff-${Date.now()}@checkin.test`
const created: string[] = []

let admin: Client
let staff: Client

async function invoke(client: Client, body: Record<string, unknown>) {
  const { data, error } = await client.functions.invoke('admin-staff', { body })
  if (!error) return { status: 200, body: data as Record<string, unknown> }
  const response = (error as { context?: Response }).context
  return { status: response?.status ?? 0, body: response ? ((await response.json()) as Record<string, unknown>) : {} }
}

beforeAll(async () => {
  admin = await signIn('admin@checkin.test')
  staff = await signIn('staff1@checkin.test')
})

afterAll(async () => {
  for (const id of created) {
    await service.from('staff_profiles').delete().eq('id', id)
    await service.auth.admin.deleteUser(id)
  }
})

describe('admin-staff Edge Function', () => {
  it('rejects unauthenticated and non-admin callers', async () => {
    const anon = createClient<Database>(config.url, config.anonKey, noSession)
    const body = { action: 'create', email, password: 'Passw0rd!new', full_name: 'x', role: 'staff' }
    expect((await invoke(anon, body)).status).toBe(401)
    expect(await invoke(staff, body)).toEqual({ status: 403, body: { ok: false, code: 'forbidden' } })
  })

  it('validates input', async () => {
    const result = await invoke(admin, { action: 'create', email: 'not-an-email', password: 'short', full_name: '', role: 'root' })
    expect(result).toEqual({ status: 400, body: { ok: false, code: 'invalid_input' } })
  })

  it('creates a login with a staff profile, audited, that can sign in', async () => {
    const result = await invoke(admin, {
      action: 'create',
      email,
      password: 'Passw0rd!new',
      full_name: 'เจ้าหน้าที่ ใหม่',
      role: 'staff',
    })
    expect(result.status).toBe(200)
    const staffId = result.body.staff_id as string
    created.push(staffId)

    const { data: profile } = await service.from('staff_profiles').select('full_name, role, is_active').eq('id', staffId).single()
    expect(profile).toEqual({ full_name: 'เจ้าหน้าที่ ใหม่', role: 'staff', is_active: true })

    const { data: audit } = await service
      .from('audit_logs')
      .select('action, details')
      .eq('action', 'staff.create')
      .contains('details', { staff_id: staffId })
    expect(audit).toHaveLength(1)

    const login = createClient<Database>(config.url, config.anonKey, noSession)
    const { error } = await login.auth.signInWithPassword({ email, password: 'Passw0rd!new' })
    expect(error).toBeNull()
  })

  it('enforces the password policy (letters and digits)', async () => {
    const result = await invoke(admin, {
      action: 'create',
      email: `weak-${Date.now()}@checkin.test`,
      password: 'onlyletters',
      full_name: 'รหัสอ่อน',
      role: 'staff',
    })
    expect(result).toEqual({ status: 400, body: { ok: false, code: 'weak_password' } })
  })

  it('refuses a duplicate e-mail', async () => {
    const result = await invoke(admin, {
      action: 'create',
      email: 'staff1@checkin.test',
      password: 'Passw0rd!new',
      full_name: 'ซ้ำ',
      role: 'staff',
    })
    expect(result).toEqual({ status: 409, body: { ok: false, code: 'email_exists' } })
  })

  it('resets a password (audited, password never logged)', async () => {
    const staffId = created[0]!
    expect((await invoke(admin, { action: 'reset_password', staff_id: staffId, password: 'Passw0rd!reset' })).status).toBe(200)

    const login = createClient<Database>(config.url, config.anonKey, noSession)
    expect((await login.auth.signInWithPassword({ email, password: 'Passw0rd!reset' })).error).toBeNull()

    const { data: audit } = await service
      .from('audit_logs')
      .select('details')
      .eq('action', 'staff.password_reset')
      .contains('details', { staff_id: staffId })
    expect(audit).toHaveLength(1)
    expect(JSON.stringify(audit)).not.toContain('Passw0rd')
  })

  it('public sign-up stays disabled', async () => {
    const anon = createClient<Database>(config.url, config.anonKey, noSession)
    const { error } = await anon.auth.signUp({ email: `intruder-${Date.now()}@checkin.test`, password: PASSWORD })
    expect(error?.code).toBe('signup_disabled')
  })
})
