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

/** The first check-ins of an event get a highlighted order number. */
export const FIRST_CHECKINS_LIMIT = 100

export function isFirstCheckin(checkinNo: number | undefined): checkinNo is number {
  return checkinNo !== undefined && checkinNo <= FIRST_CHECKINS_LIMIT
}

/** Assigned station of another station, or null when the member belongs here (or has none). */
export function otherAssignedStation(member: MemberRow, myStationCode: string) {
  return member.assigned_station_code && member.assigned_station_code !== myStationCode
    ? member.assigned_station_code
    : null
}

export function assignmentLabel(member: MemberRow) {
  if (!member.assigned_station_code) return null
  return `จุด ${member.assigned_station_code}${member.payout_seq ? ` · ลำดับ ${member.payout_seq}` : ''}`
}
