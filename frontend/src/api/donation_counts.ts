import { apiFetch } from './client'
import type { DonationCount } from '../types'

export function getDonationCounts(params?: { sport_id?: string; company_id?: string }) {
  const qs = new URLSearchParams()
  if (params?.sport_id) qs.set('sport_id', params.sport_id)
  if (params?.company_id) qs.set('company_id', params.company_id)
  return apiFetch<DonationCount[]>(`/donation-counts?${qs}`)
}

export function upsertDonationCount(company_id: string, sport_id: string, item_count: number) {
  return apiFetch<DonationCount>('/donation-counts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_id, sport_id, item_count }),
  })
}

export function deleteDonationCount(id: string) {
  return apiFetch<void>(`/donation-counts/${id}`, { method: 'DELETE' })
}

export function recomputeDonationPoints(sport_id: string) {
  return apiFetch<void>(`/donation-counts/sports/${sport_id}/recompute`, { method: 'POST' })
}
