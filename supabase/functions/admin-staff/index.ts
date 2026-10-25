// Admin-only staff account management. The service role key exists only here (server-side).
// Actions:
//   { action: 'create', email, password, full_name, role }
//   { action: 'reset_password', staff_id, password }
import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@4'

// Comma-separated production origins (e.g. https://checkin.example.org). Unset = any origin (local dev).
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean)

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allow = allowedOrigins.length === 0 ? '*' : allowedOrigins.includes(origin) ? origin : allowedOrigins[0]!
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

const password = z.string().min(8).max(72)
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    email: z.email(),
    password,
    full_name: z.string().trim().min(1),
    role: z.enum(['admin', 'supervisor', 'staff']),
  }),
  z.object({ action: z.literal('reset_password'), staff_id: z.guid(), password }),
])

Deno.serve(async (req) => {
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(405, { ok: false, code: 'method_not_allowed' })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // Identify the caller from their own JWT, then check the role in the database.
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { ok: false, code: 'not_authenticated' })
  const { data: caller, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !caller.user) return json(401, { ok: false, code: 'not_authenticated' })

  const { data: profile } = await admin
    .from('staff_profiles')
    .select('role, is_active')
    .eq('id', caller.user.id)
    .maybeSingle()
  if (!profile || !profile.is_active || profile.role !== 'admin') return json(403, { ok: false, code: 'forbidden' })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json(400, { ok: false, code: 'invalid_input' })
  const body = parsed.data

  const audit = (action: string, details: Record<string, unknown>) =>
    admin.from('audit_logs').insert({ actor_id: caller.user.id, action, details })

  if (body.action === 'create') {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    })
    if (error || !created.user) {
      if (error?.code === 'weak_password') return json(400, { ok: false, code: 'weak_password' })
      const exists = error?.code === 'email_exists' || /already/i.test(error?.message ?? '')
      return json(exists ? 409 : 500, { ok: false, code: exists ? 'email_exists' : 'create_failed' })
    }

    const { error: profileError } = await admin
      .from('staff_profiles')
      .insert({ id: created.user.id, full_name: body.full_name, role: body.role })
    if (profileError) {
      // Compensate so no login exists without a profile.
      await admin.auth.admin.deleteUser(created.user.id)
      return json(500, { ok: false, code: 'create_failed' })
    }

    await audit('staff.create', { staff_id: created.user.id, email: body.email, role: body.role, full_name: body.full_name })
    return json(200, { ok: true, staff_id: created.user.id })
  }

  const { data: target } = await admin.from('staff_profiles').select('id').eq('id', body.staff_id).maybeSingle()
  if (!target) return json(404, { ok: false, code: 'staff_not_found' })
  const { error } = await admin.auth.admin.updateUserById(body.staff_id, { password: body.password })
  if (error?.code === 'weak_password') return json(400, { ok: false, code: 'weak_password' })
  if (error) return json(500, { ok: false, code: 'reset_failed' })
  await audit('staff.password_reset', { staff_id: body.staff_id })
  return json(200, { ok: true })
})
