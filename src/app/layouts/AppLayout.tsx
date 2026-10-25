import {
  ClipboardCheck,
  FileBarChart,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  ScrollText,
  Settings,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { signOut } from '@/features/auth/AuthProvider'
import { canAccess, type AppRoute } from '@/features/auth/access'
import { useStaffContext } from '@/features/auth/StaffContext'
import { cn } from '@/lib/utils'
import { ConnectionBanner } from './ConnectionBanner'

const navItems: { to: AppRoute; label: string; icon: LucideIcon }[] = [
  { to: '/dashboard', label: 'แดชบอร์ด', icon: LayoutDashboard },
  { to: '/check-in', label: 'ลงทะเบียน', icon: ClipboardCheck },
  { to: '/history', label: 'ประวัติการลงทะเบียน', icon: History },
  { to: '/reports', label: 'รายงาน', icon: FileBarChart },
  { to: '/members', label: 'สมาชิก', icon: Users },
  { to: '/staff', label: 'เจ้าหน้าที่และจุดลงทะเบียน', icon: UserCog },
  { to: '/settings', label: 'ตั้งค่ากิจกรรม', icon: Settings },
  { to: '/audit-logs', label: 'บันทึกการตรวจสอบ', icon: ScrollText },
]

const roleLabels = { admin: 'ผู้ดูแลระบบ', supervisor: 'หัวหน้างาน', staff: 'เจ้าหน้าที่' } as const

function StationBadge() {
  const { station } = useStaffContext()
  if (!station) return <span className="text-sm text-warning">ยังไม่ได้รับมอบหมายจุดลงทะเบียน</span>
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-sm font-medium text-primary">
      <MapPin className="size-4" aria-hidden />
      {station.station_code} · {station.station_name}
    </span>
  )
}

function UserMenu() {
  const { staff } = useStaffContext()
  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <p className="text-sm font-medium">{staff.full_name}</p>
        <p className="text-xs text-muted">{roleLabels[staff.role]}</p>
      </div>
      <Button variant="ghost" size="icon" onClick={() => void signOut()} aria-label="ออกจากระบบ" title="ออกจากระบบ">
        <LogOut className="size-5" aria-hidden />
      </Button>
    </div>
  )
}

/** Staff: compact topbar, minimal navigation. */
function StaffLayout() {
  const { open_event } = useStaffContext()
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="font-semibold text-primary">Smart Check-in 2569</span>
          <nav className="flex gap-1">
            {navItems
              .filter((item) => canAccess('staff', item.to))
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn('rounded-md px-3 py-1.5 text-sm', isActive ? 'bg-primary-soft text-primary' : 'hover:bg-primary-soft')
                  }
                >
                  {item.label}
                </NavLink>
              ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden truncate text-sm text-muted md:inline">
            {open_event?.title ?? 'ไม่มีกิจกรรมที่เปิดอยู่'}
          </span>
          <StationBadge />
          <UserMenu />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-4">
        <Outlet />
      </main>
    </div>
  )
}

/** Admin / supervisor: sidebar navigation. */
function SidebarLayout() {
  const { staff, open_event } = useStaffContext()
  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <p className="font-semibold text-primary">Smart Check-in 2569</p>
          <p className="truncate text-xs text-muted">{open_event?.title ?? 'ไม่มีกิจกรรมที่เปิดอยู่'}</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-auto p-2">
          {navItems
            .filter((item) => canAccess(staff.role, item.to))
            .map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                    isActive ? 'bg-primary-soft font-medium text-primary' : 'hover:bg-primary-soft',
                  )
                }
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </NavLink>
            ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-end gap-4 border-b border-border bg-surface px-4">
          {canAccess(staff.role, '/check-in') && <StationBadge />}
          <UserMenu />
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function AppLayout() {
  const { staff } = useStaffContext()
  return (
    <div className="flex h-full flex-col">
      <ConnectionBanner />
      <div className="min-h-0 flex-1">{staff.role === 'staff' ? <StaffLayout /> : <SidebarLayout />}</div>
    </div>
  )
}
