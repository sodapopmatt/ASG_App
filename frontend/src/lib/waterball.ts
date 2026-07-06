import type { Match, Team, Company } from '../types'

/**
 * Rounds survived is entered via the generic heat-result endpoint and stored
 * as a string in `match.notes` (the same mechanism Human Pyramid/Relay Race
 * use for their time). Points = rounds_survived + 1 (showing up and dropping
 * the first toss is still 1 point), or 0 on forfeit/double-forfeit; null if
 * the match hasn't been played yet. Mirrors the backend's
 * `_match_points()` in `backend/app/routers/waterball_results.py` — keep
 * the two in sync if this formula ever changes.
 */
export function waterballMatchPoints(match: Match): number | null {
  if (match.status === 'forfeit' || match.status === 'double_forfeit') return 0
  if (match.status === 'completed' && match.notes != null) {
    const rounds = parseInt(match.notes, 10)
    return isNaN(rounds) ? null : rounds + 1
  }
  return null
}

/**
 * Nests a group's flat one-match-per-team list under each team's company
 * (e.g. "Apex" > "Apex-A", "Apex-B"), sorted by company name then team name.
 * Shared by the Schedule page and the public Games/results view so both
 * render Water Ball Toss groups identically.
 */
export function groupMatchesByCompany(
  matches: Match[],
  teamMap: Record<string, Team>,
  companyMap: Record<string, Company>,
): { company: Company; rows: { match: Match; team: Team }[] }[] {
  const byCompany = new Map<string, { company: Company; rows: { match: Match; team: Team }[] }>()
  for (const m of matches) {
    const team = m.home_team_id ? teamMap[m.home_team_id] : undefined
    if (!team) continue
    const company = companyMap[team.company_id]
    if (!company) continue
    const entry = byCompany.get(company.id) ?? { company, rows: [] }
    entry.rows.push({ match: m, team })
    byCompany.set(company.id, entry)
  }
  return [...byCompany.values()]
    .map(g => ({ ...g, rows: g.rows.sort((a, b) => (a.team.name ?? '').localeCompare(b.team.name ?? '')) }))
    .sort((a, b) => a.company.name.localeCompare(b.company.name))
}
