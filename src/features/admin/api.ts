import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'

export const adminErrorMessages: Record<string, string> = {
  forbidden: 'ไม่มีสิทธิ์ดำเนินการ',
  invalid_input: 'ข้อมูลไม่ครบหรือไม่ถูกต้อง',
  empty_file: 'ไม่มีข้อมูลในไฟล์',
  too_many_rows: 'ไฟล์มีข้อมูลเกิน 10,000 แถว',
  invalid_rows: 'มีแถวที่ไม่ถูกต้อง',
  unchanged: 'ไม่มีการเปลี่ยนแปลง',
  member_not_found: 'ไม่พบสมาชิก',
  event_not_found: 'ไม่พบกิจกรรม',
  invalid_transition: 'เปลี่ยนสถานะกิจกรรมแบบนี้ไม่ได้',
  no_eligible_members: 'ต้องสร้างรายชื่อผู้มีสิทธิ์ก่อนเปิดกิจกรรม',
  another_event_open: 'มีกิจกรรมอื่นเปิดอยู่ ต้องปิดกิจกรรมนั้นก่อน',
  event_not_draft: 'ทำได้เฉพาะกิจกรรมที่ยังเป็นร่าง',
  event_closed: 'กิจกรรมปิดแล้ว',
  station_not_found: 'ไม่พบจุดลงทะเบียน',
  duplicate_code: 'รหัสจุดลงทะเบียนซ้ำ',
  staff_not_found: 'ไม่พบบัญชีเจ้าหน้าที่',
  staff_inactive: 'บัญชีเจ้าหน้าที่ถูกปิดใช้งาน',
  role_cannot_check_in: 'หัวหน้างานไม่สามารถประจำจุดลงทะเบียนได้',
  station_inactive: 'จุดลงทะเบียนถูกปิดใช้งาน',
  cannot_modify_self: 'ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้',
  reason_required: 'กรุณาระบุเหตุผล',
  checkin_not_found: 'ไม่พบรายการลงทะเบียน',
  not_active: 'รายการนี้ไม่ได้อยู่ในสถานะลงทะเบียน',
  not_cancelled: 'รายการนี้ไม่ได้ถูกยกเลิก',
  member_inactive: 'สมาชิกพ้นสภาพแล้ว',
  email_exists: 'อีเมลนี้มีบัญชีอยู่แล้ว',
  weak_password: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว และมีทั้งตัวอักษรและตัวเลข',
  not_authenticated: 'หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่',
}

export function adminErrorMessage(code: string | undefined) {
  return (code && adminErrorMessages[code]) ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่'
}

const resultSchema = z.looseObject({ ok: z.boolean(), code: z.string().optional() })
export type AdminResult = z.infer<typeof resultSchema>

export class AdminError extends Error {
  constructor(
    readonly code: string | undefined,
    readonly result?: AdminResult,
  ) {
    super(adminErrorMessage(code))
  }
}

/** Calls an admin RPC that returns {ok, code}; throws AdminError on {ok:false} or transport errors. */
export async function adminRpc(fn: string, args: Record<string, unknown>): Promise<AdminResult> {
  const { data, error } = await supabase.rpc(fn as never, args as never)
  if (error) throw new AdminError(error.code === '42501' ? 'forbidden' : undefined)
  const result = resultSchema.parse(data)
  if (!result.ok) throw new AdminError(result.code, result)
  return result
}

/** Mutation that toasts the outcome and refreshes the given queries. */
export function useAdminMutation<TVars>(
  run: (vars: TVars) => Promise<AdminResult>,
  options: { success?: string; invalidate?: QueryKey[] } = {},
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      if (options.success) toast.success(options.success)
      for (const key of options.invalidate ?? []) void queryClient.invalidateQueries({ queryKey: key })
    },
    onError: (error) => {
      toast.error(error instanceof AdminError ? error.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่')
    },
  })
}

/** Calls the admin-staff Edge Function (service role stays server-side). */
export async function adminStaffFunction(body: Record<string, unknown>): Promise<AdminResult> {
  const { data, error } = await supabase.functions.invoke('admin-staff', { body })
  if (!error) return resultSchema.parse(data)
  const response = (error as { context?: Response }).context
  const parsed = response ? resultSchema.safeParse(await response.json().catch(() => null)) : null
  throw new AdminError(parsed?.success ? parsed.data.code : undefined)
}
