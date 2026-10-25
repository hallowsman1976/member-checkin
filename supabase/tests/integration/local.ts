import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/types/database'

export const PASSWORD = 'Passw0rd!local' // seed.sql test password, local only
export const noSession = { auth: { persistSession: false, autoRefreshToken: false } }

type LocalConfig = { url: string; anonKey: string; serviceKey: string }
let cached: LocalConfig | undefined

/** Local Supabase URL and keys, from env or `supabase status` (slow, so read once). */
export function localConfig(): LocalConfig {
  cached ??= readConfig()
  return cached
}

function readConfig(): LocalConfig {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }
  }
  const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8' })) as Record<string, string>
  return { url: status.API_URL!, anonKey: status.ANON_KEY!, serviceKey: status.SERVICE_ROLE_KEY! }
}

export async function signIn(email: string, password = PASSWORD) {
  const { url, anonKey } = localConfig()
  const client = createClient<Database>(url, anonKey, noSession)
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return client
}
