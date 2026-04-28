import { apiFetch } from './client'
import type { Team } from '../types'

export function getTeams(params?: { company_id?: string; sport_id?: string }) {
  const q = new URLSearchParams()
  if (params?.company_id) q.set('company_id', params.company_id)
  if (params?.sport_id) q.set('sport_id', params.sport_id)
  const qs = q.toString()
  return apiFetch<Team[]>(`/teams${qs ? `?${qs}` : ''}`)
}

export function getTeam(id: string) {
  return apiFetch<Team>(`/teams/${id}`)
}

export function createTeam(body: { company_id: string; sport_id: string; name?: string | null }) {
  return apiFetch<Team>('/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteTeam(id: string) {
  return apiFetch<void>(`/teams/${id}`, { method: 'DELETE' })
}
