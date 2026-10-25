// Thai locale uses the Buddhist calendar (พ.ศ.); always display in Bangkok time.
const dateTimeFormat = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  dateStyle: 'medium',
  timeStyle: 'short',
})

const timeFormat = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export function formatDateTime(iso: string) {
  return dateTimeFormat.format(new Date(iso))
}

export function formatTime(iso: string) {
  return timeFormat.format(new Date(iso))
}
