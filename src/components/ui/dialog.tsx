import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Modal built on the native <dialog> (focus trap, Esc, top layer). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className={cn(
        'm-auto w-full max-w-lg rounded-xl border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-foreground/40',
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="ปิด" className="rounded-md p-1 hover:bg-primary-soft">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="overflow-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  )
}
