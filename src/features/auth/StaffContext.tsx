import { createContext, useContext } from 'react'
import type { MyContext, StaffRole } from './access'

export type ActiveStaffContext = Omit<MyContext, 'staff'> & {
  staff: NonNullable<MyContext['staff']> & { role: StaffRole }
}

export const StaffContext = createContext<ActiveStaffContext | null>(null)

export function useStaffContext() {
  const ctx = useContext(StaffContext)
  if (!ctx) throw new Error('useStaffContext must be used inside ProtectedApp')
  return ctx
}
