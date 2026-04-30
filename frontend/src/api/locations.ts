import { apiFetch } from './client'
import type { Location } from '../types'

export function getLocations(sportId?: string): Promise<Location[]> {
  const qs = sportId ? `?sport_id=${sportId}` : ''
  return apiFetch<Location[]>(`/locations${qs}`)
}

export function createLocation(sportId: string, name: string): Promise<Location> {
  return apiFetch<Location>('/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sport_id: sportId, name }),
  })
}

export function deleteLocation(locationId: string): Promise<void> {
  return apiFetch<void>(`/locations/${locationId}`, { method: 'DELETE' })
}
