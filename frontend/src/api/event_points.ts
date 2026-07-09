import { apiFetch } from './client'
import type { EventPoints } from '../types'

export function getEventPoints(params?: { company_id?: string; sport_id?: string }) {
  const qs = new URLSearchParams()
  if (params?.company_id) qs.set('company_id', params.company_id)
  if (params?.sport_id) qs.set('sport_id', params.sport_id)
  const qsStr = qs.toString()
  // No trailing slash — the backend route is registered at /event-points
  // (no slash); a trailing slash triggers a 307 redirect (harmless, but an
  // avoidable extra round-trip on every fetch).
  return apiFetch<EventPoints[]>(`/event-points${qsStr ? `?${qsStr}` : ''}`)
}

// Wipes every company's saved points for one sport — zeroes out its
// contribution to the leaderboard/Standings entirely. Does not touch
// matches or brackets.
export function clearEventPoints(sport_id: string) {
  return apiFetch<void>(`/event-points?sport_id=${sport_id}`, { method: 'DELETE' })
}

export function awardPlacement(
  company_id: string,
  sport_id: string,
  placement: number,
  tied_through?: number,
  points?: number,
) {
  const qs = new URLSearchParams({ company_id, sport_id, placement: String(placement) })
  if (tied_through != null) qs.set('tied_through', String(tied_through))
  // Omit to derive points from the sport's scale (the default for every
  // sport); pass explicitly to override the scale for this one company.
  if (points != null) qs.set('points', String(points))
  return apiFetch<EventPoints>(`/event-points/award-placement?${qs}`, { method: 'POST' })
}
