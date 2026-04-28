import { apiFetch } from './client'
import type { RosterEntry } from '../types'

export function getRosterEntries(teamId: string) {
  return apiFetch<RosterEntry[]>(`/roster-entries?team_id=${teamId}`)
}

export function addRosterEntry(teamId: string, playerName: string) {
  return apiFetch<RosterEntry>('/roster-entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ team_id: teamId, player_name: playerName }),
  })
}

export function removeRosterEntry(entryId: string) {
  return apiFetch<void>(`/roster-entries/${entryId}`, { method: 'DELETE' })
}
