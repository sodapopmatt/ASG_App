import { apiFetch } from './client'
import type { EventPoints } from '../types'

export function getEventPoints(params?: { company_id?: string; sport_id?: string }) {
  const qs = new URLSearchParams()
  if (params?.company_id) qs.set('company_id', params.company_id)
  if (params?.sport_id) qs.set('sport_id', params.sport_id)
  return apiFetch<EventPoints[]>(`/event-points/?${qs}`)
}

export function awardPlacement(company_id: string, sport_id: string, placement: number) {
  const qs = new URLSearchParams({ company_id, sport_id, placement: String(placement) })
  return apiFetch<EventPoints>(`/event-points/award-placement?${qs}`, { method: 'POST' })
}
