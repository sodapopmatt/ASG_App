import { apiFetch } from './client'
import type { Sport } from '../types'

export const getSports = () => apiFetch<Sport[]>('/sports')

export const resetBrackets = (sportId: string) =>
  apiFetch<void>(`/sports/${sportId}/brackets`, { method: 'DELETE' })

export const resetBracketPhase = (sportId: string) =>
  apiFetch<void>(`/sports/${sportId}/bracket-phase`, { method: 'DELETE' })

export interface ReconcileAdvancementResponse {
  reconciled_count: number
  reconciled: Array<{
    match_id: string
    before: Record<string, [string | null, string | null]>
    after: Record<string, [string | null, string | null]>
  }>
}

export const reconcileAdvancement = (sportId: string) =>
  apiFetch<ReconcileAdvancementResponse>(`/sports/${sportId}/reconcile-advancement`, { method: 'POST' })

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
  forfeit_wins: number
  draws: number
  losses: number
  played: number
  rank: number
  tournament_points: number
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

export interface ChampionshipStandings {
  bracket_id: string | null
  standings: TeamStanding[]
  current_round: number
}

export const getChampionshipStandings = (sportId: string) =>
  apiFetch<ChampionshipStandings>(`/sports/${sportId}/championship-standings`)

export const generateSwissRound = (sportId: string) =>
  apiFetch<{ bracket_id: string; round: number; matches_created: number }>(
    `/sports/${sportId}/generate-swiss-round`,
    { method: 'POST' },
  )

export function updateSport(sportId: string, body: Partial<Sport>) {
  return apiFetch<Sport>(`/sports/${sportId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Persists a full seed order in one request instead of one PATCH per team,
// avoiding a burst of concurrent requests when reordering a large team list.
export function setSeedOrder(sportId: string, teamIds: string[]) {
  return apiFetch<void>(`/sports/${sportId}/seed-order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ team_ids: teamIds }),
  })
}

export function setPoolSetup(
  sportId: string,
  body: { pool_count?: number | null; team_pool?: Record<string, number>; court_pool?: Record<string, number> },
) {
  return apiFetch<void>(`/sports/${sportId}/pool-setup`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
