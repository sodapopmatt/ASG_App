// Advisory final-ranking computation for the Scoring page. These are pure
// functions that derive a suggested placement order from finished matches /
// standings; the admin reviews (and can edit) every row before publishing,
// and the authoritative write is always POST /event-points/award-placement.
import type { Match, Bracket, Team, Company } from '../types'
import type { PoolStandings, ChampionshipStandings } from '../api/sports'
import { compareBracketNames } from './bracketHelpers'

export interface RankedTeam {
  teamId: string
  detail?: string     // per-team label, e.g. "1:42.305" or "2–1 in Pool A"
  forfeited?: boolean // no-show — flagged so the admin can apply the −10 deduction
}

// One tier of the final order; every team inside a group is tied.
export interface TieGroup {
  teams: RankedTeam[]
  detail?: string      // fallback label when a team has none of its own
  zeroPoints?: boolean // heats-style forfeits: default to 0 points, not the scale
}

export interface OtherTeamResult {
  teamName: string
  detail: string
}

export interface CompanyRow {
  companyId: string
  companyName: string
  // null = nothing computed yet (no bracket/results at all) — the admin
  // fills this in by hand, same editable row as a computed placement.
  placement: number | null
  tiedThrough: number | null  // last place in the tie; == placement when untied
  detail: string
  forfeited: boolean
  zeroPoints: boolean
  // Name/label of the team whose result this row's placement/detail came
  // from — the company row itself isn't a team, so the admin's per-team
  // breakdown needs this to label that first entry (undefined when there's
  // no team context at all, e.g. a manual placement row).
  primaryTeamName?: string
  // Results of this company's OTHER teams (all worse than the one that
  // scored) — for the admin's optional per-team breakdown. Never affects
  // placement or points; purely informational.
  otherTeams: OtherTeamResult[]
}

// ── Points scales ─────────────────────────────────────────────────────────────

// ASG default scale (1st=40, 2nd=38, … −2/place; 20th and beyond all earn 2),
// or the sport's own points_scale if it has one — mirrors the backend's
// `_scale_points()` in event_points.py so previews match what Save awards.
export function scalePoints(placement: number, pointsScale: Record<string, number> | null): number {
  if (pointsScale) return Number(pointsScale[String(placement)] ?? pointsScale.default ?? 0)
  return Math.max(2, 40 - (placement - 1) * 2)
}

// Default points for a company row: tied places average their scale values
// (mirrors the backend's `_compute_points()` tie handling).
export function defaultPoints(
  row: Pick<CompanyRow, 'placement' | 'tiedThrough' | 'zeroPoints'>,
  pointsScale: Record<string, number> | null,
): number {
  if (row.zeroPoints || row.placement === null || row.tiedThrough === null) return 0
  let sum = 0
  let count = 0
  for (let p = row.placement; p <= row.tiedThrough; p++) {
    sum += scalePoints(p, pointsScale)
    count++
  }
  return count > 0 ? Math.round(sum / count) : 0
}

// A sport with no matches/results at all yet — every company starts blank
// (placement unknown) so the admin can fill placements in by hand, in the
// exact same editable table used once results exist. Previously-saved
// placements (if an admin already entered some) sort to the top.
export function buildManualRows(
  companies: Company[],
  savedByCompany: Record<string, { placement: number }>,
): CompanyRow[] {
  return [...companies]
    .sort((a, b) => {
      const pa = savedByCompany[a.id]?.placement
      const pb = savedByCompany[b.id]?.placement
      if (pa != null && pb != null) return pa - pb
      if (pa != null) return -1
      if (pb != null) return 1
      return a.name.localeCompare(b.name)
    })
    .map(c => ({
      companyId: c.id,
      companyName: c.name,
      placement: null,
      tiedThrough: null,
      detail: 'No results yet',
      forfeited: false,
      zeroPoints: false,
      otherTeams: [],
    }))
}

// ── Shared match helpers ──────────────────────────────────────────────────────

function isDecided(m: Match): boolean {
  return (m.status === 'completed' || m.status === 'forfeit') && !!m.winner_id
}

function loserOf(m: Match): string | null {
  if (!isDecided(m)) return null
  if (m.home_team_id && m.home_team_id !== m.winner_id) return m.home_team_id
  if (m.away_team_id && m.away_team_id !== m.winner_id) return m.away_team_id
  return null
}

function teamsIn(matches: Match[]): Set<string> {
  const ids = new Set<string>()
  for (const m of matches) {
    if (m.home_team_id) ids.add(m.home_team_id)
    if (m.away_team_id) ids.add(m.away_team_id)
  }
  return ids
}

interface Elimination {
  round: number
  forfeited: boolean
  phase: string | null
}

// Where (and how) each team's tournament ended: its lost match, or a
// double forfeit. Winners-bracket losses in double elim are NOT eliminations
// (the team drops to the losers bracket) — callers filter by phase.
function collectEliminations(matches: Match[], phaseOf: (m: Match) => string | null): {
  eliminated: Map<string, Elimination>
  deadTeams: Map<string, Elimination> // double forfeits: out with no result at all
} {
  const eliminated = new Map<string, Elimination>()
  const deadTeams = new Map<string, Elimination>()
  for (const m of matches) {
    const phase = phaseOf(m)
    if (m.status === 'double_forfeit') {
      for (const teamId of [m.home_team_id, m.away_team_id]) {
        if (teamId) deadTeams.set(teamId, { round: m.match_round ?? 0, forfeited: true, phase })
      }
      continue
    }
    const loser = loserOf(m)
    if (loser) {
      const existing = eliminated.get(loser)
      const entry: Elimination = { round: m.match_round ?? 0, forfeited: m.status === 'forfeit', phase }
      // A team can lose twice in double elim (WB then LB) — keep the later loss.
      if (!existing || entry.round >= existing.round) eliminated.set(loser, entry)
    }
  }
  return { eliminated, deadTeams }
}

// ── Single elimination ────────────────────────────────────────────────────────

// 1st = winner of the final (the match no winner advances out of), 2nd = its
// loser, then losers grouped by the round they were knocked out in (later =
// better), each round-group tied. Double forfeits land in a flagged last group.
export function rankSingleElim(
  matches: Match[],
  phaseByBracket: Record<string, string | null>,
): TieGroup[] {
  const phaseOf = (m: Match) => (m.bracket_id ? phaseByBracket[m.bracket_id] ?? null : null)
  const elimMatches = matches.filter(m => phaseOf(m) !== 'pool')
  if (elimMatches.length === 0) return []

  const allTeams = teamsIn(elimMatches)
  const { eliminated, deadTeams } = collectEliminations(elimMatches, phaseOf)

  const root = elimMatches
    .filter(m => m.winner_next_match_id === null)
    .sort((a, b) => (b.match_round ?? 0) - (a.match_round ?? 0))[0]

  const groups: TieGroup[] = []
  const placed = new Set<string>()

  if (root && isDecided(root)) {
    placed.add(root.winner_id!)
    groups.push({ teams: [{ teamId: root.winner_id!, detail: 'Won the final' }] })
    const runnerUp = loserOf(root)
    if (runnerUp) {
      placed.add(runnerUp)
      groups.push({ teams: [{ teamId: runnerUp, detail: 'Lost the final', forfeited: root.status === 'forfeit' }] })
    }
  }

  // Not knocked out yet (bracket unfinished) — tied ahead of eliminated teams.
  const stillIn = [...allTeams].filter(id => !placed.has(id) && !eliminated.has(id) && !deadTeams.has(id))
  if (stillIn.length > 0) {
    groups.push({ teams: stillIn.map(teamId => ({ teamId })), detail: 'Still in bracket' })
    stillIn.forEach(id => placed.add(id))
  }

  // Eliminated teams by round, later rounds first.
  const byRound = new Map<number, RankedTeam[]>()
  for (const [teamId, e] of eliminated) {
    if (placed.has(teamId)) continue
    const list = byRound.get(e.round) ?? []
    list.push({ teamId, detail: e.forfeited ? 'Forfeited' : `Out in round ${e.round}`, forfeited: e.forfeited })
    byRound.set(e.round, list)
  }
  for (const round of [...byRound.keys()].sort((a, b) => b - a)) {
    groups.push({ teams: byRound.get(round)!, detail: `Out in round ${round}` })
  }

  const dead = [...deadTeams.keys()].filter(id => !placed.has(id) && !eliminated.has(id))
  if (dead.length > 0) {
    groups.push({ teams: dead.map(teamId => ({ teamId, detail: 'Double forfeit', forfeited: true })) })
  }

  return groups
}

// ── Double elimination ────────────────────────────────────────────────────────

// 1st/2nd from the grand final; division-final losses (Basketball's venue
// split) rank above all losers-bracket rounds; everyone else by the
// losers-bracket round they were knocked out in, later rounds better.
export function rankDoubleElim(
  matches: Match[],
  phaseByBracket: Record<string, string | null>,
): TieGroup[] {
  const phaseOf = (m: Match) => (m.bracket_id ? phaseByBracket[m.bracket_id] ?? null : null)
  const elimMatches = matches.filter(m => phaseOf(m) !== 'pool')
  if (elimMatches.length === 0) return []

  const allTeams = teamsIn(elimMatches)
  const { deadTeams } = collectEliminations(elimMatches, phaseOf)

  const root = elimMatches
    .filter(m => m.winner_next_match_id === null)
    .sort((a, b) => (b.match_round ?? 0) - (a.match_round ?? 0))[0]

  const groups: TieGroup[] = []
  const placed = new Set<string>()

  if (root && isDecided(root)) {
    placed.add(root.winner_id!)
    groups.push({ teams: [{ teamId: root.winner_id!, detail: 'Won the grand final' }] })
    const runnerUp = loserOf(root)
    if (runnerUp) {
      placed.add(runnerUp)
      groups.push({ teams: [{ teamId: runnerUp, detail: 'Lost the grand final', forfeited: root.status === 'forfeit' }] })
    }
  }

  // A team is only OUT of double elim when it loses in the losers bracket or
  // in a finals match (a winners-bracket loss just drops it down).
  const knockedOut = new Map<string, { round: number; forfeited: boolean; finals: boolean }>()
  for (const m of elimMatches) {
    const phase = phaseOf(m)
    if (phase !== 'losers' && phase !== 'finals') continue
    const loser = loserOf(m)
    if (!loser || placed.has(loser)) continue
    knockedOut.set(loser, {
      round: m.match_round ?? 0,
      forfeited: m.status === 'forfeit',
      finals: phase === 'finals',
    })
  }

  const stillIn = [...allTeams].filter(id => !placed.has(id) && !knockedOut.has(id) && !deadTeams.has(id))
  if (stillIn.length > 0) {
    groups.push({ teams: stillIn.map(teamId => ({ teamId })), detail: 'Still in bracket' })
    stillIn.forEach(id => placed.add(id))
  }

  // Division-final losers (venue split) rank above every losers-bracket round.
  const divisionFinalLosers: RankedTeam[] = []
  const byRound = new Map<number, RankedTeam[]>()
  for (const [teamId, k] of knockedOut) {
    const entry: RankedTeam = {
      teamId,
      detail: k.forfeited ? 'Forfeited' : k.finals ? 'Lost division final' : `Out in losers round ${k.round}`,
      forfeited: k.forfeited,
    }
    if (k.finals) divisionFinalLosers.push(entry)
    else {
      const list = byRound.get(k.round) ?? []
      list.push(entry)
      byRound.set(k.round, list)
    }
  }
  if (divisionFinalLosers.length > 0) groups.push({ teams: divisionFinalLosers, detail: 'Lost division final' })
  for (const round of [...byRound.keys()].sort((a, b) => b - a)) {
    groups.push({ teams: byRound.get(round)!, detail: `Out in losers round ${round}` })
  }

  const dead = [...deadTeams.keys()].filter(id => !placed.has(id) && !knockedOut.has(id))
  if (dead.length > 0) {
    groups.push({ teams: dead.map(teamId => ({ teamId, detail: 'Double forfeit', forfeited: true })) })
  }

  return groups
}

// ── Pool play ─────────────────────────────────────────────────────────────────

// Teams with identical cross-pool records tie. `order` lists the record fields
// to sort by, best first; each is (team) => number with higher = better.
function groupByRecord(
  rows: { teamId: string; detail: string; key: number[] }[],
): TieGroup[] {
  const byKey = new Map<string, { teamId: string; detail: string; key: number[] }[]>()
  for (const r of rows) {
    const k = r.key.join('|')
    const list = byKey.get(k) ?? []
    list.push(r)
    byKey.set(k, list)
  }
  return [...byKey.values()]
    .sort((a, b) => {
      for (let i = 0; i < a[0].key.length; i++) {
        if (a[0].key[i] !== b[0].key[i]) return b[0].key[i] - a[0].key[i]
      }
      return 0
    })
    .map(list => ({ teams: list.map(r => ({ teamId: r.teamId, detail: r.detail })) }))
}

// Bracket-phase finishers first (single-elim logic), then everyone knocked out
// at pool stage by cross-pool W-L record (identical records tie).
export function rankPoolBracket(
  matches: Match[],
  brackets: Bracket[],
  standings: PoolStandings[],
): TieGroup[] {
  const phaseByBracket: Record<string, string | null> = Object.fromEntries(brackets.map(b => [b.id, b.phase]))
  const bracketGroups = rankSingleElim(
    matches.filter(m => m.bracket_id && phaseByBracket[m.bracket_id] !== 'pool'),
    phaseByBracket,
  )

  const inBracket = new Set(bracketGroups.flatMap(g => g.teams.map(t => t.teamId)))
  const poolRows = standings.flatMap(pool =>
    pool.standings
      .filter(s => !inBracket.has(s.team_id))
      .map(s => ({
        teamId: s.team_id,
        detail: `${s.wins}–${s.losses} in ${pool.name}`,
        key: [s.wins, -s.losses],
      })),
  )

  return [...bracketGroups, ...groupByRecord(poolRows)]
}

// Swiss championship finishers first (in championship-standings order, equal
// ranks tied), then pool-stage teams by cross-pool tournament record.
export function rankPoolSwiss(
  standings: PoolStandings[],
  championship: ChampionshipStandings | null,
): TieGroup[] {
  const groups: TieGroup[] = []
  const inChampionship = new Set<string>()

  if (championship && championship.standings.length > 0) {
    const byRank = new Map<number, RankedTeam[]>()
    for (const s of championship.standings) {
      inChampionship.add(s.team_id)
      const list = byRank.get(s.rank) ?? []
      list.push({ teamId: s.team_id, detail: `${s.tournament_points} pts in Championship` })
      byRank.set(s.rank, list)
    }
    for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
      groups.push({ teams: byRank.get(rank)! })
    }
  }

  const poolRows = standings.flatMap(pool =>
    pool.standings
      .filter(s => !inChampionship.has(s.team_id))
      .map(s => ({
        teamId: s.team_id,
        detail: `${s.wins}–${s.losses}, ${s.tournament_points} pts in ${pool.name}`,
        key: [s.tournament_points, s.goal_diff, s.goals_for],
      })),
  )

  return [...groups, ...groupByRecord(poolRows)]
}

// ── Heats ─────────────────────────────────────────────────────────────────────

function formatHeatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  const millis = ms % 1000
  return `${m}:${String(s).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

// Flat heats (Human Pyramid): every team has one opponent-less match whose
// result lives in matches.notes. low_wins = smallest value first (fastest
// time); equal values tie. Forfeits land last with 0 points by default.
export function rankFlatHeats(
  matches: Match[],
  scoringDirection: 'high_wins' | 'low_wins',
): TieGroup[] {
  const results: { teamId: string; value: number }[] = []
  const forfeits: string[] = []
  for (const m of matches) {
    if (!m.home_team_id) continue
    if (m.status === 'forfeit' || m.status === 'double_forfeit') {
      forfeits.push(m.home_team_id)
      continue
    }
    if (m.status !== 'completed' || !m.notes) continue
    const value = parseInt(m.notes, 10)
    if (!isNaN(value)) results.push({ teamId: m.home_team_id, value })
  }

  results.sort((a, b) => (scoringDirection === 'low_wins' ? a.value - b.value : b.value - a.value))

  const groups: TieGroup[] = []
  let lastValue: number | null = null
  for (const r of results) {
    const entry: RankedTeam = { teamId: r.teamId, detail: formatHeatTime(r.value) }
    if (lastValue !== null && r.value === lastValue) groups[groups.length - 1].teams.push(entry)
    else groups.push({ teams: [entry] })
    lastValue = r.value
  }
  if (forfeits.length > 0) {
    groups.push({ teams: forfeits.map(teamId => ({ teamId, detail: 'Forfeit', forfeited: true })), zeroPoints: true })
  }
  return groups
}

// Relay Race grouped heats: teams are tiered by how far they advanced
// (Final > Semi-Finals > 3rd in prelim > 4th+ in prelim), strictly ordered
// by their rank within the phase's heats — no ties. Forfeits last, 0 points.
export function rankRelayHeats(brackets: Bracket[], matches: Match[]): TieGroup[] {
  const matchesByBracket: Record<string, Match[]> = {}
  for (const m of matches) {
    if (m.bracket_id) (matchesByBracket[m.bracket_id] ??= []).push(m)
  }

  const phaseOrder: Record<string, number> = { heats: 1, bracket: 2, finals: 3 }
  const sortedBrackets = [...brackets].sort((a, b) => {
    const ao = phaseOrder[a.phase ?? ''] ?? 99
    const bo = phaseOrder[b.phase ?? ''] ?? 99
    return ao !== bo ? ao - bo : compareBracketNames(a.name, b.name)
  })

  const tiers: { teamId: string; tier: number; heatRank: number | null; phase: string; forfeited: boolean }[] = []

  for (const bracket of sortedBrackets) {
    const heatMatches = matchesByBracket[bracket.id] ?? []
    // Rank within the heat by elapsed time (fastest first).
    const completed = heatMatches
      .filter(m => m.status === 'completed' && m.notes && m.home_team_id)
      .map(m => ({ teamId: m.home_team_id!, ms: parseInt(m.notes!, 10) }))
      .filter(r => !isNaN(r.ms))
      .sort((a, b) => a.ms - b.ms)
    const rankMap: Record<string, number> = {}
    completed.forEach((r, i) => { rankMap[r.teamId] = i + 1 })

    for (const m of heatMatches) {
      if (!m.home_team_id) continue
      const rank = rankMap[m.home_team_id] ?? null
      const forfeited = m.status === 'forfeit'

      let tier: number
      let phase: string
      if (bracket.phase === 'finals') {
        tier = 1
        phase = 'Final'
      } else if (bracket.phase === 'bracket') {
        // top 3 advance (already in finals bracket); positions 4+ get tier 2
        tier = 2
        phase = bracket.name
      } else {
        // prelim: rank 3 = tier 3, rank 4+ = tier 4; 0 = advanced (appears later)
        tier = rank !== null && rank <= 2 ? 0 : rank === 3 ? 3 : 4
        phase = bracket.name
      }

      if (forfeited) {
        tiers.push({ teamId: m.home_team_id, tier: 99, heatRank: null, phase, forfeited: true })
      } else if (tier !== 0) {
        tiers.push({ teamId: m.home_team_id, tier, heatRank: rank, phase, forfeited: false })
      }
    }
  }

  // A team appearing in multiple phases keeps only its most advanced one.
  const bestByTeam: Record<string, typeof tiers[0]> = {}
  for (const t of tiers) {
    const existing = bestByTeam[t.teamId]
    if (!existing || t.tier < existing.tier) bestByTeam[t.teamId] = t
  }

  const tierGroups: Record<number, typeof tiers> = {}
  for (const t of Object.values(bestByTeam)) {
    ;(tierGroups[t.tier] ??= []).push(t)
  }

  const groups: TieGroup[] = []
  for (const tier of [1, 2, 3, 4]) {
    const group = (tierGroups[tier] ?? []).sort((a, b) => (a.heatRank ?? 999) - (b.heatRank ?? 999))
    for (const t of group) {
      groups.push({ teams: [{ teamId: t.teamId, detail: t.heatRank ? `${t.phase} — #${t.heatRank}` : t.phase }] })
    }
  }
  const forfeited = tierGroups[99] ?? []
  if (forfeited.length > 0) {
    groups.push({
      teams: forfeited.map(t => ({ teamId: t.teamId, detail: 'Forfeit', forfeited: true })),
      zeroPoints: true,
    })
  }
  return groups
}

// ── Company collapse ──────────────────────────────────────────────────────────

// ASG rulebook: when a company fields multiple teams, only its highest-ranking
// team scores. Walk the tie groups best→worst, keep each company's first
// appearance, and compress company placements to a contiguous 1..M — companies
// surfacing in the same group are tied and share averaged points.
export function collapseToCompanies(
  groups: TieGroup[],
  teams: Team[],
  companies: Company[],
): CompanyRow[] {
  const teamById = Object.fromEntries(teams.map(t => [t.id, t]))
  const companyById = Object.fromEntries(companies.map(c => [c.id, c]))

  const rows: CompanyRow[] = []
  const rowByCompany = new Map<string, CompanyRow>()
  const placedCompanies = new Set<string>()
  // Every team that showed up in some tie group — anything left over never
  // appeared in a single match (e.g. added to the roster after the bracket
  // was generated) and would otherwise vanish from Scoring entirely.
  const accountedTeams = new Set<string>()
  let nextPlacement = 1

  // Distinguishes a company's teams when they have no team.name set, so the
  // "other teams" breakdown always has something to show ("Team 1", "Team 2").
  const teamLabelIndex = new Map<string, number>()
  function teamLabel(team: Team): string {
    if (team.name) return team.name
    if (!teamLabelIndex.has(team.id)) {
      const used = [...teamLabelIndex.entries()].filter(([id]) => teamById[id]?.company_id === team.company_id).length
      teamLabelIndex.set(team.id, used + 1)
    }
    return `Team ${teamLabelIndex.get(team.id)}`
  }

  for (const group of groups) {
    const fresh: { companyId: string; team: RankedTeam; teamName: string }[] = []
    // A company's non-scoring team can appear in this SAME group as its
    // scoring team (e.g. an entire company still undecided in the bracket,
    // tied with everyone else not yet eliminated) — that row doesn't exist
    // yet while we're still scanning, so defer attaching until after this
    // group's rows are built below.
    const pendingOther: { companyId: string; teamName: string; detail: string }[] = []

    for (const rt of group.teams) {
      const team = teamById[rt.teamId]
      if (!team) continue
      accountedTeams.add(team.id)
      if (placedCompanies.has(team.company_id)) {
        pendingOther.push({
          companyId: team.company_id,
          teamName: teamLabel(team),
          detail: rt.detail ?? group.detail ?? '',
        })
        continue
      }
      placedCompanies.add(team.company_id)
      fresh.push({ companyId: team.company_id, team: rt, teamName: teamLabel(team) })
    }

    if (fresh.length > 0) {
      const placement = nextPlacement
      const tiedThrough = placement + fresh.length - 1
      for (const f of fresh) {
        const row: CompanyRow = {
          companyId: f.companyId,
          companyName: companyById[f.companyId]?.name ?? '?',
          placement,
          tiedThrough,
          detail: f.team.detail ?? group.detail ?? '',
          forfeited: !!f.team.forfeited,
          zeroPoints: !!group.zeroPoints,
          primaryTeamName: f.teamName,
          otherTeams: [],
        }
        rows.push(row)
        rowByCompany.set(f.companyId, row)
      }
      nextPlacement = tiedThrough + 1
    }

    // Every company appearing for the first time in this group now has a
    // row — safe to attach any of its other teams also seen in this group.
    for (const p of pendingOther) {
      rowByCompany.get(p.companyId)?.otherTeams.push({ teamName: p.teamName, detail: p.detail })
    }
  }

  // Sweep: any team never mentioned by a single tie group (no matches at
  // all yet) still needs to be visible — attach it to its company's row if
  // one exists, or give the company a blank row so it isn't dropped outright.
  for (const team of teams) {
    if (accountedTeams.has(team.id)) continue
    accountedTeams.add(team.id)
    const existingRow = rowByCompany.get(team.company_id)
    if (!existingRow) {
      rows.push({
        companyId: team.company_id,
        companyName: companyById[team.company_id]?.name ?? '?',
        placement: null,
        tiedThrough: null,
        detail: 'No results yet',
        forfeited: false,
        zeroPoints: false,
        primaryTeamName: teamLabel(team),
        otherTeams: [],
      })
      rowByCompany.set(team.company_id, rows[rows.length - 1])
    } else {
      // A genuine second team for this company (the first already has a row).
      existingRow.otherTeams.push({ teamName: teamLabel(team), detail: 'No result yet' })
    }
  }

  // Keep ranked rows in their existing (placement) order; place any blank,
  // nothing-recorded rows after them, sorted alphabetically for scannability.
  rows.sort((a, b) => {
    if (a.placement !== null && b.placement !== null) return 0
    if (a.placement !== null) return -1
    if (b.placement !== null) return 1
    return a.companyName.localeCompare(b.companyName)
  })

  return rows
}
