import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { myContextSchema } from './access'

export const myContextQueryKey = (userId: string | undefined) => ['my-context', userId] as const

export function useMyContext(userId: string | undefined) {
  return useQuery({
    queryKey: myContextQueryKey(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_context')
      if (error) throw error
      return myContextSchema.parse(data)
    },
    staleTime: 60_000,
  })
}
