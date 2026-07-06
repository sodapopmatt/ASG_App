import { apiFetch } from './client'

export function recomputeWaterballPoints(sport_id: string) {
  return apiFetch<void>(`/waterball-results/sports/${sport_id}/recompute`, { method: 'POST' })
}
