import { Loader2, ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { useAuth, signOut } from './AuthProvider'
import { canAccess, homeRouteFor, type AppRoute } from './access'
import { StaffContext, useStaffContext } from './StaffContext'
import { useMyContext } from './useMyContext'

function FullScreenMessage({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6">{children}</div>
}

function AccessDenied({ message }: { message: string }) {
  return (
    <FullScreenMessage>
      <div className="max-w-sm space-y-4 text-center">
        <ShieldAlert className="mx-auto size-10 text-danger" aria-hidden />
        <p className="text-lg font-medium">{message}</p>
        <Button variant="outline" onClick={() => void signOut()}>
          ออกจากระบบ
        </Button>
      </div>
    </FullScreenMessage>
  )
}

/** Requires a session and an active staff profile; provides StaffContext to children. */
export function ProtectedApp({ children }: { children: ReactNode }) {
  const { session, isLoading } = useAuth()
  const location = useLocation()
  const context = useMyContext(session?.user.id)

  if (!isLoading && !session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (context.isError) return <AccessDenied message="โหลดข้อมูลผู้ใช้ไม่สำเร็จ กรุณาลองใหม่" />
  if (isLoading || context.isPending) {
    return (
      <FullScreenMessage>
        <Loader2 className="size-8 animate-spin text-primary" aria-label="กำลังโหลด" />
      </FullScreenMessage>
    )
  }

  const { staff } = context.data
  if (!staff) return <AccessDenied message="บัญชีนี้ยังไม่ได้ลงทะเบียนเป็นเจ้าหน้าที่" />
  if (!staff.is_active) return <AccessDenied message="บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ" />

  return <StaffContext value={{ ...context.data, staff }}>{children}</StaffContext>
}

export function RequireRole({ route }: { route: AppRoute }) {
  const { staff } = useStaffContext()
  if (!canAccess(staff.role, route)) return <Navigate to={homeRouteFor(staff.role)} replace />
  return <Outlet />
}

export function HomeRedirect() {
  const { staff } = useStaffContext()
  return <Navigate to={homeRouteFor(staff.role)} replace />
}
