import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm placeholder:text-muted disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
