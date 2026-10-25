import { WifiOff } from 'lucide-react'
import { useSyncExternalStore } from 'react'

function subscribe(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

/** Visible warning while the notebook has no network; check-ins resolve their status when it returns. */
export function ConnectionBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine)
  if (online) return null
  return (
    <div role="alert" className="flex items-center justify-center gap-2 bg-danger px-4 py-1.5 text-sm font-medium text-white">
      <WifiOff className="size-4" aria-hidden />
      เครื่องนี้ขาดการเชื่อมต่ออินเทอร์เน็ต — ห้ามลงทะเบียนซ้ำ ใช้แบบฟอร์มกระดาษสำรองถ้าขาดนานเกิน 5 นาที
    </div>
  )
}
