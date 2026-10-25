import { z } from 'zod'

export const staffRoles = ['admin', 'supervisor', 'staff'] as const
export type StaffRole = (typeof staffRoles)[number]

export const myContextSchema = z.object({
  staff: z
    .object({
      id: z.guid(),
      full_name: z.string(),
      role: z.enum(staffRoles),
      is_active: z.boolean(),
    })
    .nullable(),
  open_event: z
    .object({
      id: z.guid(),
      title: z.string(),
      event_date: z.string(),
      status: z.literal('open'),
    })
    .nullable(),
  station: z
    .object({
      id: z.guid(),
      station_code: z.string(),
      station_name: z.string(),
    })
    .nullable(),
})
export type MyContext = z.infer<typeof myContextSchema>

export type AppRoute =
  | '/check-in'
  | '/history'
  | '/dashboard'
  | '/members'
  | '/staff'
  | '/reports'
  | '/settings'
  | '/audit-logs'

// UI-side mirror of server rules; the database enforces the real permissions.
export const routeRoles: Record<AppRoute, readonly StaffRole[]> = {
  '/check-in': ['staff', 'admin'],
  '/history': ['staff', 'admin', 'supervisor'],
  '/dashboard': ['admin', 'supervisor'],
  '/members': ['admin'],
  '/staff': ['admin'],
  '/reports': ['admin', 'supervisor'],
  '/settings': ['admin'],
  '/audit-logs': ['admin'],
}

export function canAccess(role: StaffRole, route: AppRoute) {
  return routeRoles[route].includes(role)
}

export function homeRouteFor(role: StaffRole): AppRoute {
  return role === 'staff' ? '/check-in' : '/dashboard'
}
