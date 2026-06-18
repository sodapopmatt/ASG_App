import { apiFetch } from './client'
import type { Match } from '../types'

export function getMatches(params?: { sport_id?: string; bracket_id?: string; status?: string }) {
  const q = new URLSearchParams()
  if (params?.sport_id) q.set('sport_id', params.sport_id)
  if (params?.bracket_id) q.set('bracket_id', params.bracket_id)
  if (params?.status) q.set('status', params.status)
  const qs = q.toString()
  return apiFetch<Match[]>(`/matches${qs ? `?${qs}` : ''}`)
}

export function startMatch(matchId: string) {
  return apiFetch<Match>(`/matches/${matchId}/start`, { method: 'POST' })
}

export function submitResult(
  matchId: string,
  winnerId: string,
  scores?: { home_score?: number | null; away_score?: number | null },
) {
  return apiFetch<Match>(`/matches/${matchId}/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      winner_id: winnerId,
      home_score: scores?.home_score ?? null,
      away_score: scores?.away_score ?? null,
    }),
  })
}

export function submitForfeit(matchId: string, forfeitingTeamId: string) {
  return apiFetch<Match>(`/matches/${matchId}/forfeit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forfeiting_team_id: forfeitingTeamId }),
  })
}

export function submitDoubleForfeit(matchId: string, notes?: string) {
  return apiFetch<Match>(`/matches/${matchId}/double-forfeit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(notes ? { notes } : {}),
  })
}

export function submitHeatResult(matchId: string, body: { time_ms?: number; forfeit?: boolean }) {
  return apiFetch<Match>(`/matches/${matchId}/heat-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function patchMatch(matchId: string, body: { scheduled_at?: string | null; location_id?: string | null }) {
  return apiFetch<Match>(`/matches/${matchId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
