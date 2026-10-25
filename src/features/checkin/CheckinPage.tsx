import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Loader2, Search } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useStaffContext } from '@/features/auth/StaffContext'
import { formatTime } from '@/lib/format'
import { checkStatus, registerMember, searchMembers } from './api'
import { MemberResults, resultOptionId } from './MemberResults'
import type { Checkin, MemberRow, Outcome } from './outcome'
import { canConfirm, ReviewPanel, type SubmitPhase } from './ReviewPanel'
import { useDebouncedValue } from './useDebouncedValue'

const searchQueryKey = ['member-search'] as const

type LastSuccess = { member: MemberRow; checkin: Checkin; recovered: boolean }

export function CheckinPage() {
  const { open_event, station } = useStaffContext()

  if (!open_event || !station) {
    return (
      <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 text-center">
        <AlertTriangle className="size-10 text-warning" aria-hidden />
        <p className="text-lg font-medium">
          {!open_event ? 'ยังไม่มีกิจกรรมที่เปิดลงทะเบียน' : 'บัญชีนี้ยังไม่ได้รับมอบหมายจุดลงทะเบียน'}
        </p>
        <p className="text-muted">กรุณาติดต่อผู้ดูแลระบบ</p>
      </div>
    )
  }

  return <CheckinWorkspace eventId={open_event.id} />
}

function CheckinWorkspace({ eventId }: { eventId: string }) {
  const { staff } = useStaffContext()
  const queryClient = useQueryClient()

  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const [selected, setSelected] = useState<MemberRow | null>(null)
  const [verified, setVerified] = useState(false)
  const [phase, setPhase] = useState<SubmitPhase>('idle')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [lastSuccess, setLastSuccess] = useState<LastSuccess | null>(null)
  const inFlight = useRef(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const verifyRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const recheckRef = useRef<HTMLButtonElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)

  const trimmed = useDebouncedValue(query.trim(), 300)
  const search = useQuery({
    queryKey: [...searchQueryKey, eventId, trimmed],
    queryFn: ({ signal }) => searchMembers(trimmed, signal),
    enabled: trimmed.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  })
  const members = trimmed.length > 0 ? (search.data ?? []) : []

  useEffect(() => setHighlighted(0), [trimmed])

  // Move focus to the next keyboard step whenever the review state changes.
  useEffect(() => {
    if (!selected) {
      searchRef.current?.focus()
    } else if (canConfirm(selected, outcome)) {
      if (verified) confirmRef.current?.focus()
      else verifyRef.current?.focus()
    } else if (phase === 'idle') {
      if (outcome?.kind === 'unknown') recheckRef.current?.focus()
      else backRef.current?.focus()
    }
  }, [selected, outcome, verified, phase])

  function resetToSearch(clearQuery: boolean) {
    setSelected(null)
    setVerified(false)
    setOutcome(null)
    if (clearQuery) setQuery('')
  }

  function select(member: MemberRow) {
    setSelected(member)
    setVerified(false)
    setOutcome(null)
  }

  function applyOutcome(member: MemberRow, result: Outcome) {
    void queryClient.invalidateQueries({ queryKey: searchQueryKey })
    if (result.kind === 'registered') {
      setLastSuccess({ member, checkin: result.checkin, recovered: result.recovered })
      toast.success(`ลงทะเบียนสำเร็จ: ${member.full_name}`)
      resetToSearch(true)
      return
    }
    setOutcome(result)
  }

  async function confirm() {
    if (!selected || !verified || inFlight.current) return
    inFlight.current = true
    setPhase('submitting')
    try {
      applyOutcome(selected, await registerMember(eventId, selected.id, staff.id))
    } finally {
      inFlight.current = false
      setPhase('idle')
    }
  }

  async function recheck() {
    if (!selected || inFlight.current) return
    inFlight.current = true
    setPhase('checking')
    try {
      applyOutcome(selected, await checkStatus(eventId, selected.id, staff.id))
    } finally {
      inFlight.current = false
      setPhase('idle')
    }
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && members.length > 0) {
      e.preventDefault()
      setHighlighted((i) => Math.min(i + 1, members.length - 1))
    } else if (e.key === 'ArrowUp' && members.length > 0) {
      e.preventDefault()
      setHighlighted((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const member = members[highlighted]
      // Only act on results that belong to what is currently typed.
      if (member && trimmed === query.trim() && !search.isPlaceholderData) select(member)
    } else if (e.key === 'Escape') {
      setQuery('')
    }
  }

  function handlePanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && phase === 'idle') {
      e.preventDefault()
      resetToSearch(false)
    }
  }

  const highlightedMember = members[highlighted]

  return (
    <div className="mx-auto grid h-full max-w-6xl grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
      <section className="flex min-h-0 flex-col gap-3">
        {lastSuccess && (
          <div className="flex items-center gap-3 rounded-lg border border-success/40 bg-success/10 px-4 py-2 text-sm">
            <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
            <span className="truncate">
              ล่าสุด: <span className="font-semibold">{lastSuccess.member.full_name}</span> ({lastSuccess.member.member_no})
              เวลา {formatTime(lastSuccess.checkin.checked_in_at)}
              {lastSuccess.recovered && ' · ยืนยันผลหลังการเชื่อมต่อขัดข้อง'}
            </span>
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-6 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            disabled={selected !== null}
            placeholder="พิมพ์เลขสมาชิก หรือ ชื่อ-สกุล"
            aria-label="ค้นหาสมาชิก"
            role="combobox"
            aria-expanded={members.length > 0}
            aria-controls="member-results"
            aria-activedescendant={highlightedMember ? resultOptionId(highlightedMember.id) : undefined}
            autoComplete="off"
            className="h-16 pl-14 pr-12 text-2xl"
          />
          {search.isFetching && (
            <Loader2 className="absolute right-4 top-1/2 size-6 -translate-y-1/2 animate-spin text-primary" aria-label="กำลังค้นหา" />
          )}
        </div>

        <Card className="min-h-0 flex-1 overflow-auto">
          {trimmed.length === 0 ? (
            <p className="p-6 text-center text-muted">พิมพ์เพื่อค้นหา · ↑↓ เลือก · Enter เปิดรายละเอียด</p>
          ) : search.isError ? (
            <p className="p-6 text-center text-danger">ค้นหาไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง</p>
          ) : search.isPending ? (
            <div className="space-y-2 p-4" aria-label="กำลังค้นหา">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-background" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <p className="p-6 text-center text-muted">ไม่พบสมาชิกที่ตรงกับ “{trimmed}”</p>
          ) : (
            <MemberResults
              members={members}
              highlighted={highlighted}
              onHighlight={setHighlighted}
              onSelect={select}
            />
          )}
        </Card>
      </section>

      <aside onKeyDown={handlePanelKeyDown}>
        {selected ? (
          <ReviewPanel
            member={selected}
            outcome={outcome}
            phase={phase}
            verified={verified}
            onVerifiedChange={setVerified}
            onConfirm={() => void confirm()}
            onRecheck={() => void recheck()}
            onBack={() => resetToSearch(false)}
            verifyRef={verifyRef}
            confirmRef={confirmRef}
            recheckRef={recheckRef}
            backRef={backRef}
          />
        ) : (
          <Card className="flex h-full min-h-60 items-center justify-center p-6 text-center text-muted">
            เลือกสมาชิกจากผลการค้นหาเพื่อตรวจบัตรและยืนยันการลงทะเบียน
          </Card>
        )}
      </aside>
    </div>
  )
}
