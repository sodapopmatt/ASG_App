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

export interface PoolSpec {
  name: string
  team_ids: string[]
  location_ids: string[]
}

export interface HeatSpec {
  name: string
  team_ids: string[]
  phase?: string       // 'heats' | 'bracket' | 'finals'
  scheduled_at?: string
}

export interface TeamStanding {
  team_id: string
  wins: number
  draws: number
  losses: number
  played: number
  rank: number
  goals_for: number
  goals_against: number
  goal_diff: number
  game_wins: number
  point_diff: number
  total_points: number
}

export interface PoolStandings {
  bracket_id: string
  name: string
  standings: TeamStanding[]
}

export function generateBracket(
  sportId: string,
  teamIds: string[],
  clearExisting = false,
  divisions?: DivisionSpec[],
  pools?: PoolSpec[],
  heats?: HeatSpec[],
) {
  return apiFetch<unknown>(`/sports/${sportId}/generate-bracket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      team_ids: teamIds,
      clear_existing: clearExisting,
      ...(divisions ? { divisions } : {}),
      ...(pools ? { pools } : {}),
      ...(heats ? { heats } : {}),
    }),
  })
}

export const getStandings = (sportId: string) =>
  apiFetch<PoolStandings[]>(`/sports/${sportId}/standings`)

export function updateSport(sportId: string, body: Partial<Sport>) {
  return apiFetch<Sport>(`/sports/${sportId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
