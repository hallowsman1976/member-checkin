import type { ComponentType, ReactNode } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppLayout } from '@/app/layouts/AppLayout'
import type { AppRoute } from '@/features/auth/access'
import { LoginPage } from '@/features/auth/LoginPage'
import { HomeRedirect, ProtectedApp, RequireRole } from '@/features/auth/guards'
import { CheckinPage } from '@/features/checkin/CheckinPage'

function guarded(route: AppRoute, element: ReactNode): RouteObject {
  return { element: <RequireRole route={route} />, children: [{ path: route.slice(1), element }] }
}

/** Admin/report pages load on demand so the staff check-in screen starts fast. */
function guardedLazy(route: AppRoute, load: () => Promise<ComponentType>): RouteObject {
  return {
    element: <RequireRole route={route} />,
    children: [{ path: route.slice(1), lazy: async () => ({ Component: await load() }) }],
  }
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <ProtectedApp>
        <AppLayout />
      </ProtectedApp>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      guarded('/check-in', <CheckinPage />),
      guardedLazy('/history', async () => (await import('@/features/reports/HistoryPage')).HistoryPage),
      guardedLazy('/dashboard', async () => (await import('@/features/dashboard/DashboardPage')).DashboardPage),
      guardedLazy('/reports', async () => (await import('@/features/reports/ReportsPage')).ReportsPage),
      guardedLazy('/members', async () => (await import('@/features/admin/MembersPage')).MembersPage),
      guardedLazy('/staff', async () => (await import('@/features/admin/StaffPage')).StaffPage),
      guardedLazy('/settings', async () => (await import('@/features/admin/SettingsPage')).SettingsPage),
      guardedLazy('/audit-logs', async () => (await import('@/features/admin/AuditLogsPage')).AuditLogsPage),
      { path: '*', element: <HomeRedirect /> },
    ],
  },
])
