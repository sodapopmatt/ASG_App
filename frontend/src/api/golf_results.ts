import { apiFetch } from './client'
import type { Match } from '../types'

// Enter a company's per-hole scores (or a no-show forfeit) for one Executive
// Golf round. Golf needs 3 scores per match so it can't reuse the generic
// single-value heat-result endpoint — see backend/app/routers/golf_results.py.
export function submitGolfResult(matchId: string, body: { hole_scores: number[] } | { forfeit: true }) {
  return apiFetch<Match>(`/golf-results/matches/${matchId}/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Rebuild event_points from Round-2 totals. Not live — the admin reviews the
// preview on the Scoring page and explicitly saves, exactly like Water Ball Toss.
export function recomputeGolfPoints(sport_id: string) {
  return apiFetch<void>(`/golf-results/sports/${sport_id}/recompute`, { method: 'POST' })
}
