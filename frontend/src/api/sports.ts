import { apiFetch } from './client'
import type { Sport } from '../types'

export const getSports = () => apiFetch<Sport[]>('/sports')

export const resetBrackets = (sportId: string) =>
  apiFetch<void>(`/sports/${sportId}/brackets`, { method: 'DELETE' })

export function generateBracket(
  sportId: string,
  teamIds: string[],
  clearExisting = false,
) {
  return apiFetch<unknown>(`/sports/${sportId}/generate-bracket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      team_ids: teamIds,
      clear_existing: clearExisting,
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
