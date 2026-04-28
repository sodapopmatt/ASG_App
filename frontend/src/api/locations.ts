import { supabase } from '../lib/supabase'
import type { Location } from '../types'

export function getLocations(): Promise<Location[]> {
  return supabase
    .from('locations')
    .select('id, name')
    .order('name')
    .then(({ data, error }) => {
      if (error) throw new Error(error.message)
      return (data ?? []) as Location[]
    })
}
