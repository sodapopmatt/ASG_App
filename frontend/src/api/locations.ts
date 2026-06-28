import { apiFetch } from './client'
import type { Location } from '../types'

export function getLocations(sportId?: string): Promise<Location[]> {
  const qs = sportId ? `?sport_id=${sportId}` : ''
  return apiFetch<Location[]>(`/locations${qs}`)
}

export function createLocation(sportId: string, courtNumberOrName: number | string): Promise<Location> {
  const body = typeof courtNumberOrName === 'number'
    ? { sport_id: sportId, court_number: courtNumberOrName }
    : { sport_id: sportId, name: courtNumberOrName }
  return apiFetch<Location>('/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteLocation(locationId: string): Promise<void> {
  return apiFetch<void>(`/locations/${locationId}`, { method: 'DELETE' })
}

export function updateLocation(
  locationId: string,
  update: { court_number: number } | string,
): Promise<Location> {
  const body = typeof update === 'string' ? { name: update } : update
  return apiFetch<Location>(`/locations/${locationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
