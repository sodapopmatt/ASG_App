import { apiFetch } from './client'
import type { Sport } from '../types'

export const getSports = () => apiFetch<Sport[]>('/sports')

export const resetBrackets = (sportId: string) =>
  apiFetch<void>(`/sports/${sportId}/brackets`, { method: 'DELETE' })

export interface DivisionSpec {
  name: string
  team_ids: string[]
  location_ids: string[]
}

export function generateBracket(
  sportId: string,
  teamIds: string[],
  clearExisting = false,
  divisions?: DivisionSpec[],
) {
  return apiFetch<unknown>(`/sports/${sportId}/generate-bracket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      team_ids: teamIds,
      clear_existing: clearExisting,
      ...(divisions ? { divisions } : {}),
    }),
  })
}

export function updateSport(sportId: string, body: Partial<Sport>) {
  return apiFetch<Sport>(`/sports/${sportId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
