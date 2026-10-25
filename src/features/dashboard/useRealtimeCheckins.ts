import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type LiveStatus = 'connecting' | 'live' | 'offline'

/**
 * Realtime is only a "something changed" signal: it invalidates the given queries so the
 * authoritative aggregates are refetched. Every (re)subscribe also refetches, which
 * reconciles anything missed while disconnected.
 */
export function useRealtimeCheckins(eventId: string | undefined, queryKey: QueryKey) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const keyHash = JSON.stringify(queryKey)

  useEffect(() => {
    if (!eventId) return
    const key = JSON.parse(keyHash) as QueryKey
    let timer: ReturnType<typeof setTimeout> | undefined
    const invalidate = () => {
      // Coalesce bursts (8 stations registering at once) into one refetch.
      timer ??= setTimeout(() => {
        timer = undefined
        void queryClient.invalidateQueries({ queryKey: key })
      }, 500)
    }

    setStatus('connecting')
    const channel = supabase
      .channel(`checkins:${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkins', filter: `event_id=eq.${eventId}` }, invalidate)
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') {
          setStatus('live')
          invalidate()
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          setStatus('offline')
        }
      })

    return () => {
      clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [eventId, keyHash, queryClient])

  return status
}
