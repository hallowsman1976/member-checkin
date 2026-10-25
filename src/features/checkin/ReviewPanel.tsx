import { AlertTriangle, BadgeCheck, CircleX, IdCard, Loader2, RefreshCw } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { blockReason, errorMessages, memberTypeLabels } from './labels'
import type { Checkin, MemberRow, Outcome } from './outcome'

export type SubmitPhase = 'idle' | 'submitting' | 'checking'

function Notice({ tone, icon, children }: { tone: 'warning' | 'danger'; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex gap-3 rounded-lg border p-4',
        tone === 'warning' ? 'border-warning/40 bg-warning/10' : 'border-danger/40 bg-danger/10',
      )}
    >
      <span className={cn('mt-0.5 shrink-0', tone === 'warning' ? 'text-warning' : 'text-danger')}>{icon}</span>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  )
}

function CheckinDetail({ checkin }: { checkin: Checkin }) {
  return (
    <p className="text-muted">
      เมื่อ {formatDateTime(checkin.checked_in_at)} · จุด {checkin.station_code} {checkin.station_name} · โดย{' '}
      {checkin.staff_name}
    </p>
  )
}

/** Notice for the current state, or null when the member can simply be confirmed. */
function StateNotice({ member, outcome }: { member: MemberRow; outcome: Outcome | null }) {
  if (outcome?.kind === 'already_registered') {
    return (
      <Notice tone="warning" icon={<AlertTriangle className="size-5" />}>
        <p className="font-semibold">สมาชิกลงทะเบียนไปแล้ว</p>
        <CheckinDetail checkin={outcome.checkin} />
      </Notice>
    )
  }
  if (outcome?.kind === 'cancelled' || (!outcome && member.checkin_status === 'cancelled')) {
    return (
      <Notice tone="danger" icon={<CircleX className="size-5" />}>
        <p className="font-semibold">การลงทะเบียนของสมาชิกนี้ถูกยกเลิก</p>
        <p>ต้องให้ผู้ดูแลระบบเปิดการลงทะเบียนกลับมา</p>
      </Notice>
    )
  }
  if (outcome?.kind === 'error') {
    return (
      <Notice tone="danger" icon={<CircleX className="size-5" />}>
        <p className="font-semibold">ลงทะเบียนไม่สำเร็จ</p>
        <p>{errorMessages[outcome.code]}</p>
      </Notice>
    )
  }
  if (outcome?.kind === 'not_saved') {
    return (
      <Notice tone="warning" icon={<AlertTriangle className="size-5" />}>
        <p className="font-semibold">การเชื่อมต่อขัดข้อง และระบบยืนยันแล้วว่ายังไม่ได้บันทึก</p>
        <p>กดยืนยันอีกครั้งได้</p>
      </Notice>
    )
  }
  if (outcome?.kind === 'unknown') {
    return (
      <Notice tone="warning" icon={<AlertTriangle className="size-5" />}>
        <p className="font-semibold">ไม่ทราบผลการลงทะเบียน (การเชื่อมต่อขัดข้อง)</p>
        <p>ห้ามลงทะเบียนซ้ำจนกว่าจะตรวจสอบสถานะได้ กดปุ่มตรวจสอบสถานะเมื่อเชื่อมต่อได้แล้ว</p>
      </Notice>
    )
  }
  if (!outcome && member.checkin_status === 'active') {
    return (
      <Notice tone="warning" icon={<AlertTriangle className="size-5" />}>
        <p className="font-semibold">สมาชิกลงทะเบียนไปแล้ว</p>
        <p className="text-muted">
          จุด {member.station_code} {member.station_name}
          {member.checked_in_at && ` · เมื่อ ${formatDateTime(member.checked_in_at)}`}
        </p>
      </Notice>
    )
  }
  const reason = blockReason(member)
  if (reason) {
    return (
      <Notice tone="danger" icon={<CircleX className="size-5" />}>
        <p className="font-semibold">{reason}</p>
      </Notice>
    )
  }
  return null
}

/** Confirming is allowed only before any check-in exists, or after the server confirmed nothing was saved. */
export function canConfirm(member: MemberRow, outcome: Outcome | null) {
  if (outcome) return outcome.kind === 'not_saved'
  return member.checkin_status === null && blockReason(member) === null
}

export function ReviewPanel({
  member,
  outcome,
  phase,
  verified,
  onVerifiedChange,
  onConfirm,
  onRecheck,
  onBack,
  verifyRef,
  confirmRef,
  recheckRef,
  backRef,
}: {
  member: MemberRow
  outcome: Outcome | null
  phase: SubmitPhase
  verified: boolean
  onVerifiedChange: (value: boolean) => void
  onConfirm: () => void
  onRecheck: () => void
  onBack: () => void
  verifyRef: RefObject<HTMLInputElement | null>
  confirmRef: RefObject<HTMLButtonElement | null>
  recheckRef: RefObject<HTMLButtonElement | null>
  backRef: RefObject<HTMLButtonElement | null>
}) {
  const busy = phase !== 'idle'
  const confirmable = canConfirm(member, outcome)

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div>
        <p className="font-mono text-lg font-semibold text-primary">{member.member_no}</p>
        <h2 className="text-3xl font-bold leading-tight">{member.full_name}</h2>
        <p className="mt-1 text-base text-muted">
          {member.department ?? '-'} · {memberTypeLabels[member.member_type]}
        </p>
      </div>

      <StateNotice member={member} outcome={outcome} />

      {confirmable && (
        <>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-primary-soft p-4">
            <input
              ref={verifyRef}
              type="checkbox"
              className="mt-1 size-5 accent-primary"
              checked={verified}
              disabled={busy}
              onChange={(e) => onVerifiedChange(e.target.checked)}
            />
            <span className="space-y-1">
              <span className="flex items-center gap-2 font-semibold">
                <IdCard className="size-5 text-primary" aria-hidden />
                ตรวจบัตรแล้ว ชื่อ-สกุลตรงกับผู้มาลงทะเบียน
              </span>
              <span className="block text-sm text-muted">กด Space เพื่อติ๊ก แล้วกด Enter เพื่อยืนยัน</span>
            </span>
          </label>
          <Button ref={confirmRef} size="lg" className="h-16 text-xl" disabled={!verified || busy} onClick={onConfirm}>
            {phase === 'submitting' ? (
              <Loader2 className="size-6 animate-spin" aria-hidden />
            ) : (
              <BadgeCheck className="size-6" aria-hidden />
            )}
            {phase === 'submitting' ? 'กำลังบันทึก…' : 'ยืนยันลงทะเบียน'}
          </Button>
        </>
      )}

      {outcome?.kind === 'unknown' && (
        <Button ref={recheckRef} size="lg" variant="outline" disabled={busy} onClick={onRecheck}>
          {phase === 'checking' ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <RefreshCw className="size-5" aria-hidden />}
          ตรวจสอบสถานะอีกครั้ง
        </Button>
      )}

      <Button ref={backRef} variant="ghost" disabled={busy} onClick={onBack}>
        กลับไปค้นหา (Esc)
      </Button>
    </Card>
  )
}
