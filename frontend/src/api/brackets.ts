import { apiFetch } from './client'
import type { Bracket } from '../types'

export function getBrackets(sportId?: string) {
  const qs = sportId ? `?sport_id=${sportId}` : ''
  return apiFetch<Bracket[]>(`/brackets${qs}`)
}
