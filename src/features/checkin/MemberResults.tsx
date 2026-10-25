import { cn } from '@/lib/utils'
import { formatTime } from '@/lib/format'
import { blockReason, memberTypeLabels } from './labels'
import type { MemberRow } from './outcome'

export function StatusBadge({ member }: { member: MemberRow }) {
  if (member.checkin_status === 'active') {
    return (
      <span className="rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
        ลงทะเบียนแล้ว {member.checked_in_at && formatTime(member.checked_in_at)} · {member.station_code}
      </span>
    )
  }
  if (member.checkin_status === 'cancelled') {
    return <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-medium text-danger">ถูกยกเลิก</span>
  }
  if (blockReason(member)) {
    return (
      <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-medium text-danger">
        {member.is_active ? 'ไม่มีสิทธิ์' : 'พ้นสภาพ'}
      </span>
    )
  }
  return <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">ยังไม่ลงทะเบียน</span>
}

export const resultOptionId = (memberId: string) => `member-option-${memberId}`

export function MemberResults({
  members,
  highlighted,
  onHighlight,
  onSelect,
}: {
  members: MemberRow[]
  highlighted: number
  onHighlight: (index: number) => void
  onSelect: (member: MemberRow) => void
}) {
  return (
    <ul id="member-results" role="listbox" aria-label="ผลการค้นหาสมาชิก" className="divide-y divide-border">
      {members.map((m, i) => (
        <li
          key={m.id}
          id={resultOptionId(m.id)}
          role="option"
          aria-selected={i === highlighted}
          onMouseEnter={() => onHighlight(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(m)}
          className={cn(
            'flex cursor-pointer items-center gap-4 px-4 py-3',
            i === highlighted ? 'bg-primary-soft' : 'hover:bg-background',
          )}
        >
          <span className="w-20 shrink-0 font-mono text-base font-semibold">{m.member_no}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-medium">{m.full_name}</span>
            <span className="block truncate text-sm text-muted">
              {m.department ?? '-'} · {memberTypeLabels[m.member_type]}
            </span>
          </span>
          <StatusBadge member={m} />
        </li>
      ))}
    </ul>
  )
}
