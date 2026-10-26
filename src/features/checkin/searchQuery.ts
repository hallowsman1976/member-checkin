const MEMBER_NO_LENGTH = 5

/** Digit-only input shorter than a member number gets leading zeros: "123" -> "00123". */
export function normalizeSearchQuery(query: string) {
  return /^\d+$/.test(query) ? query.padStart(MEMBER_NO_LENGTH, '0') : query
}
