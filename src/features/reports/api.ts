import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'

const memberType = z.enum(['ordinary', 'associate'])
const checkinStatus = z.enum(['active', 'cancelled'])

export const eventSchema = z.object({
  id: z.guid(),
  title: z.string(),
  event_date: z.string(),
  status: z.enum(['draft', 'open', 'closed']),
})
export type EventRow = z.infer<typeof eventSchema>

export const stationSchema = z.object({ id: z.guid(), station_code: z.string(), station_name: z.string() })
export type StationRow = z.infer<typeof stationSchema>

export function useEvents() {
  return useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, title, event_date, status')
        .order('event_date', { ascending: false })
      if (error) throw error
      return z.array(eventSchema).parse(data)
    },
    staleTime: 60_000,
  })
}

export function useStations() {
  return useQuery({
    queryKey: ['stations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stations')
        .select('id, station_code, station_name')
        .order('station_code')
      if (error) throw error
      return z.array(stationSchema).parse(data)
    },
    staleTime: 5 * 60_000,
  })
}

export const dashboardStatsSchema = z.object({
  as_of: z.string(),
  eligible: z.number(),
  registered: z.number(),
  remaining: z.number(),
  cancelled: z.number(),
  by_station: z.array(
    z.object({ station_id: z.guid(), station_code: z.string(), station_name: z.string(), registered: z.number() }),
  ),
  by_member_type: z.array(z.object({ member_type: memberType, eligible: z.number(), registered: z.number() })),
  recent: z.array(
    z.object({ member_no: z.string(), full_name: z.string(), station_code: z.string(), checked_in_at: z.string() }),
  ),
})
export type DashboardStats = z.infer<typeof dashboardStatsSchema>

export async function fetchDashboardStats(eventId: string) {
  const { data, error } = await supabase.rpc('get_dashboard_stats', { p_event_id: eventId })
  if (error) throw error
  return dashboardStatsSchema.parse(data)
}

/** Shared filters for history, reports and exports. Times are ISO strings. */
export type Filters = {
  stationId?: string
  memberType?: z.infer<typeof memberType>
  status?: z.infer<typeof checkinStatus>
  from?: string
  to?: string
}

export const historyRowSchema = z.object({
  id: z.guid(),
  member_no: z.string(),
  full_name: z.string(),
  department: z.string().nullable(),
  member_type: memberType,
  status: checkinStatus,
  checked_in_at: z.string(),
  station_code: z.string(),
  station_name: z.string(),
  staff_name: z.string(),
  cancel_reason: z.string().nullable(),
  cancelled_at: z.string().nullable(),
})
export type HistoryRow = z.infer<typeof historyRowSchema>

const pageSchema = <T extends z.ZodType>(row: T) => z.object({ total: z.number(), rows: z.array(row) })

export async function fetchHistory(eventId: string, filters: Filters, limit: number, offset: number) {
  const { data, error } = await supabase.rpc('list_checkins', {
    p_event_id: eventId,
    p_station_id: filters.stationId,
    p_member_type: filters.memberType,
    p_status: filters.status,
    p_from: filters.from,
    p_to: filters.to,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  return pageSchema(historyRowSchema).parse(data)
}

export const reportFilters = ['all', 'registered', 'unregistered'] as const
export type ReportFilter = (typeof reportFilters)[number]

export const reportRowSchema = z.object({
  member_no: z.string(),
  full_name: z.string(),
  department: z.string().nullable(),
  member_type: memberType,
  is_registered: z.boolean(),
  checkin_status: checkinStatus.nullable(),
  checked_in_at: z.string().nullable(),
  station_code: z.string().nullable(),
  station_name: z.string().nullable(),
  staff_name: z.string().nullable(),
})
export type ReportRow = z.infer<typeof reportRowSchema>

function reportArgs(eventId: string, filter: ReportFilter, filters: Filters) {
  return {
    p_event_id: eventId,
    p_filter: filter,
    p_station_id: filters.stationId,
    p_member_type: filters.memberType,
    p_from: filters.from,
    p_to: filters.to,
  }
}

export async function fetchReport(eventId: string, filter: ReportFilter, filters: Filters, limit: number, offset: number) {
  const { data, error } = await supabase.rpc('get_report', {
    ...reportArgs(eventId, filter, filters),
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  return pageSchema(reportRowSchema).parse(data)
}

/** Fetches every matching row; the server writes the audit entry in the same call. */
export async function fetchExportRows(eventId: string, format: 'xlsx' | 'csv', filter: ReportFilter, filters: Filters) {
  const { data, error } = await supabase.rpc('export_report', { ...reportArgs(eventId, filter, filters), p_format: format })
  if (error) throw error
  return z.array(reportRowSchema).parse(data)
}
