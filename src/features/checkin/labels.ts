import type { MemberRow, RegisterErrorCode } from './outcome'

export const memberTypeLabels: Record<MemberRow['member_type'], string> = {
  ordinary: 'สมาชิกสามัญ',
  associate: 'สมาชิกสมทบ',
}

export const errorMessages: Record<RegisterErrorCode, string> = {
  not_authenticated: 'หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่',
  staff_inactive: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
  forbidden: 'บัญชีนี้ไม่มีสิทธิ์ลงทะเบียน',
  event_not_found: 'ไม่พบกิจกรรม',
  event_not_open: 'กิจกรรมไม่ได้เปิดลงทะเบียนแล้ว',
  no_station: 'บัญชีนี้ยังไม่ได้รับมอบหมายจุดลงทะเบียน',
  station_inactive: 'จุดลงทะเบียนนี้ถูกปิดใช้งาน',
  member_not_found: 'ไม่พบสมาชิกในระบบ',
  member_inactive: 'สมาชิกพ้นสภาพ ไม่สามารถลงทะเบียนได้',
  member_not_eligible: 'สมาชิกไม่มีสิทธิ์เข้าร่วมกิจกรรมนี้',
  request_rejected: 'ระบบปฏิเสธคำขอ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง',
  invalid_response: 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาติดต่อผู้ดูแลระบบ',
}

/** Why a search result cannot be registered, or null when it can. */
export function blockReason(member: MemberRow): string | null {
  if (!member.is_active) return errorMessages.member_inactive
  if (!member.is_eligible) return errorMessages.member_not_eligible
  return null
}
