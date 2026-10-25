import { describe, expect, it } from 'vitest'
import { canAccess, homeRouteFor, myContextSchema, routeRoles, type AppRoute } from './access'

describe('canAccess', () => {
  it('limits admin-only routes to admin', () => {
    for (const route of ['/members', '/staff', '/settings', '/audit-logs'] as AppRoute[]) {
      expect(canAccess('admin', route)).toBe(true)
      expect(canAccess('supervisor', route)).toBe(false)
      expect(canAccess('staff', route)).toBe(false)
    }
  })

  it('keeps supervisors out of check-in', () => {
    expect(canAccess('supervisor', '/check-in')).toBe(false)
    expect(canAccess('staff', '/check-in')).toBe(true)
    expect(canAccess('admin', '/check-in')).toBe(true)
  })

  it('sends every role home to a route it can access', () => {
    for (const role of ['admin', 'supervisor', 'staff'] as const) {
      expect(canAccess(role, homeRouteFor(role))).toBe(true)
    }
  })

  it('covers every route', () => {
    expect(Object.keys(routeRoles)).toHaveLength(8)
  })
})

describe('myContextSchema', () => {
  it('accepts a context without profile, event or station', () => {
    expect(myContextSchema.parse({ staff: null, open_event: null, station: null })).toEqual({
      staff: null,
      open_event: null,
      station: null,
    })
  })

  it('rejects an unknown role', () => {
    const result = myContextSchema.safeParse({
      staff: { id: '10000000-0000-0000-0000-000000000001', full_name: 'x', role: 'root', is_active: true },
      open_event: null,
      station: null,
    })
    expect(result.success).toBe(false)
  })
})
