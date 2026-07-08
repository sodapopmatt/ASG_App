import type { Match } from '../types'

/** Executive Golf holes played per round. */
export const HOLES = 3

export const ROUND_1_NAME = 'Round 1'
export const ROUND_2_NAME = 'Round 2'

/**
 * Per-hole scores for a completed golf match. They're stored as a JSON array
 * in `match.notes` by POST /golf-results/matches/{id}/result (the total is
 * also mirrored to `match.home_score`). Returns null if the match hasn't been
 * played or was a forfeit.
 */
export function golfHoleScores(match: Match): number[] | null {
  if (match.status !== 'completed' || match.notes == null) return null
  try {
    const parsed = JSON.parse(match.notes)
    return Array.isArray(parsed) ? parsed.map(Number) : null
  } catch {
    return null
  }
}

/**
 * Total strokes for a completed golf round: `home_score` if present, else the
 * sum of the per-hole notes. null if the match hasn't been completed (an
 * unplayed match or a forfeit has no total). Mirror of the backend's
 * `_round_total()` in golf_results.py — keep the two in sync.
 */
export function golfTotal(match: Match): number | null {
  if (match.status !== 'completed') return null
  if (match.home_score != null) return match.home_score
  const holes = golfHoleScores(match)
  return holes ? holes.reduce((a, b) => a + b, 0) : null
}

/** True once a company's match for a round has a result (played or no-show). */
export function golfPlayed(match: Match): boolean {
  return match.status === 'completed' || match.status === 'forfeit' || match.status === 'double_forfeit'
}
