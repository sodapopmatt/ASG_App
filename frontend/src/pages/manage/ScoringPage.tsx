import { useState, useMemo } from 'react'
import BackLink from '../../components/BackLink'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSports } from '../../api/sports'
import { getTeams } from '../../api/teams'
import { getCompanies } from '../../api/companies'
import { getMatches } from '../../api/matches'
import { getBrackets } from '../../api/brackets'
import { getEventPoints, awardPlacement } from '../../api/event_points'
import { getDonationCounts } from '../../api/donation_counts'
import { recomputeWaterballPoints } from '../../api/waterball_results'
import { recomputeGolfPoints } from '../../api/golf_results'
import { getSportIcon } from '../../lib/sportIcons'
import type { Sport, Company, EventPoints, Match, Bracket, Team, DonationCount } from '../../types'
import { compareBracketNames } from '../../lib/bracketHelpers'
import { waterballMatchPoints } from '../../lib/waterball'
import { ROUND_2_NAME, golfTotal, golfPlayed } from '../../lib/golf'

// ── Relay Race scoring ────────────────────────────────────────────────────────

const RELAY_SCALE: Record<string, number> = {
  '1': 40, '2': 38, '3': 36, '4': 34, '5': 32, '6': 30,
  '7': 22, '8': 22, '9': 22, '10': 22, '11': 22, '12': 22,
  '13': 12, '14': 12, '15': 12, '16': 12, '17': 12, '18': 12,
}

function relayPoints(placement: number | null): number {
  if (placement === null) return 0
  return RELAY_SCALE[String(placement)] ?? 4
}

function rankMatches(matches: Match[]): Record<string, number> {
  const completed = matches
    .filter(m => m.status === 'completed' && m.notes)
    .map(m => ({ teamId: m.home_team_id!, ms: parseInt(m.notes!, 10) }))
    .filter(r => !isNaN(r.ms))
    .sort((a, b) => a.ms - b.ms)
  const map: Record<string, number> = {}
  completed.forEach((r, i) => { map[r.teamId] = i + 1 })
  return map
}

interface RelayRow {
  companyId: string
  companyName: string
  teamId: string
  phase: string        // label for display
  heatRank: number | null
  placement: number | null  // null = forfeit/no result
  points: number
}

function computeRelayPlacements(
  brackets: Bracket[],
  matches: Match[],
  teams: Team[],
  companies: Company[],
): RelayRow[] {
  const companyMap = Object.fromEntries(companies.map(c => [c.id, c]))
  const teamMap = Object.fromEntries(teams.map(t => [t.id, t]))

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
    const rankMap = rankMatches(heatMatches)

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
        // top 3 advance (already in finals bracket), positions 4+ get tier 2
        tier = 2
        phase = bracket.name
      } else {
        // prelim: rank 3 = tier 3, rank 4+ = tier 4
        tier = rank !== null && rank <= 2 ? 0 : rank === 3 ? 3 : 4  // 0 = advanced, won't appear here
        phase = bracket.name
      }

      if (!forfeited) {
        if (tier === 0) continue  // advanced to semis/finals; will appear in later bracket
        tiers.push({ teamId: m.home_team_id, tier, heatRank: rank, phase, forfeited: false })
      } else {
        tiers.push({ teamId: m.home_team_id, tier: 99, heatRank: null, phase, forfeited: true })
      }
    }
  }

  // Remove teams that appear in multiple phases — keep the most advanced phase
  const bestByTeam: Record<string, typeof tiers[0]> = {}
  for (const t of tiers) {
    const existing = bestByTeam[t.teamId]
    if (!existing || t.tier < existing.tier) bestByTeam[t.teamId] = t
  }

  // Assign placement numbers within each tier, ordered by heatRank then teamId
  const tierGroups: Record<number, typeof tiers> = {}
  for (const t of Object.values(bestByTeam)) {
    ;(tierGroups[t.tier] ??= []).push(t)
  }

  const rows: RelayRow[] = []
  let nextPlacement = 1

  for (const tier of [1, 2, 3, 4]) {
    const group = (tierGroups[tier] ?? []).sort((a, b) => (a.heatRank ?? 999) - (b.heatRank ?? 999))
    for (const t of group) {
      const team = teamMap[t.teamId]
      if (!team) continue
      const company = companyMap[team.company_id]
      rows.push({
        companyId: team.company_id,
        companyName: company?.name ?? '?',
        teamId: t.teamId,
        phase: t.phase,
        heatRank: t.heatRank,
        placement: nextPlacement,
        points: relayPoints(nextPlacement),
      })
      nextPlacement++
    }
  }

  // Forfeited teams at the end
  for (const t of (tierGroups[99] ?? [])) {
    const team = teamMap[t.teamId]
    if (!team) continue
    const company = companyMap[team.company_id]
    rows.push({
      companyId: team.company_id,
      companyName: company?.name ?? '?',
      teamId: t.teamId,
      phase: t.phase,
      heatRank: null,
      placement: null,
      points: 0,
    })
  }

  return rows
}

function RelayRaceScoringSection({
  sport,
  companies,
  teams,
}: {
  sport: Sport
  companies: Company[]
  teams: Team[]
}) {
  const qc = useQueryClient()

  const { data: matches = [] } = useQuery({
    queryKey: ['matches', { sport_id: sport.id }],
    queryFn: () => getMatches({ sport_id: sport.id }),
  })
  const { data: brackets = [] } = useQuery({
    queryKey: ['brackets', sport.id],
    queryFn: () => getBrackets(sport.id),
  })

  const computed = useMemo(
    () => computeRelayPlacements(brackets, matches, teams, companies),
    [brackets, matches, teams, companies],
  )

  // Overrides: companyId → placement (null = forfeit)
  const [overrides, setOverrides] = useState<Record<string, number | null>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function getPlacement(row: RelayRow): number | null {
    return overrides[row.companyId] !== undefined ? overrides[row.companyId] : row.placement
  }

  function getPoints(row: RelayRow): number {
    const p = getPlacement(row)
    return relayPoints(p)
  }

  async function handleSaveAll() {
    setSaving(true)
    setSaveError(null)
    try {
      for (const row of computed) {
        const p = getPlacement(row)
        if (p === null) continue  // forfeits get no event_points record
        await awardPlacement(row.companyId, sport.id, p)
      }
      qc.invalidateQueries({ queryKey: ['event-points'] })
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save placements')
    } finally {
      setSaving(false)
    }
  }

  if (computed.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-6">
        No heat results yet. Enter results from the Heats Results page first.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Auto-computed placements
        </p>
        <p className="text-xs text-gray-400">Edit placements to override</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="grid gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider"
          style={{ gridTemplateColumns: '2rem 1fr auto auto' }}>
          <span>#</span><span>Company</span><span className="text-right">Pts</span><span className="text-right">Place</span>
        </div>
        <div className="divide-y divide-gray-50">
          {computed.map(row => {
            const p = getPlacement(row)
            const pts = getPoints(row)
            return (
              <div key={row.companyId} className="grid items-center px-4 py-2.5 gap-2"
                style={{ gridTemplateColumns: '2rem 1fr auto auto' }}>
                <span className="text-xs font-bold text-gray-400 tabular-nums">{p ?? '—'}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{row.companyName}</p>
                  <p className="text-xs text-gray-400 truncate">{row.phase}</p>
                </div>
                <span className={`text-sm font-bold tabular-nums ${pts > 0 ? 'text-blue-600' : 'text-gray-300'}`}>
                  {pts}
                </span>
                <input
                  type="number"
                  min={1}
                  value={overrides[row.companyId] !== undefined
                    ? (overrides[row.companyId] ?? '')
                    : (row.placement ?? '')}
                  onChange={e => {
                    const val = e.target.value === '' ? null : Number(e.target.value)
                    setOverrides(prev => ({ ...prev, [row.companyId]: val }))
                  }}
                  placeholder="—"
                  className="w-14 text-center text-sm rounded-lg border border-gray-200 px-2 py-1 text-slate-700 tabular-nums"
                />
              </div>
            )
          })}
        </div>
      </div>

      {saveError && <p className="text-sm text-red-600">{saveError}</p>}
      <button
        onClick={handleSaveAll}
        disabled={saving}
        className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save All Placements'}
      </button>
    </div>
  )
}

// ── Standard scoring (inline placement table for non-relay sports) ────────────

function StandardScoringSection({
  sport,
  companies,
  eventPoints,
}: {
  sport: Sport
  companies: Company[]
  eventPoints: EventPoints[]
}) {
  const qc = useQueryClient()
  const sportPoints = useMemo(
    () => eventPoints.filter(ep => ep.sport_id === sport.id),
    [eventPoints, sport.id],
  )
  const existingByCompany = useMemo(
    () => Object.fromEntries(sportPoints.map(ep => [ep.company_id, ep])),
    [sportPoints],
  )

  const [placements, setPlacements] = useState<Record<string, string>>(() =>
    Object.fromEntries(sportPoints.map(ep => [ep.company_id, String(ep.placement)]))
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Sort: placed companies first (by placement), then unplaced alphabetically
  const sortedCompanies = useMemo(() => {
    return [...companies].sort((a, b) => {
      const pa = existingByCompany[a.id]?.placement
      const pb = existingByCompany[b.id]?.placement
      if (pa != null && pb != null) return pa - pb
      if (pa != null) return -1
      if (pb != null) return 1
      return a.name.localeCompare(b.name)
    })
  }, [companies, existingByCompany])

  async function handleSaveAll() {
    setSaving(true)
    setSaveError(null)
    try {
      for (const company of companies) {
        const p = placements[company.id]
        if (!p) continue
        await awardPlacement(company.id, sport.id, Number(p))
      }
      qc.invalidateQueries({ queryKey: ['event-points'] })
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save placements')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="grid gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider"
          style={{ gridTemplateColumns: '2rem 1fr auto auto' }}>
          <span>#</span><span>Company</span><span className="text-right">Pts</span><span className="text-right">Place</span>
        </div>
        <div className="divide-y divide-gray-50">
          {sortedCompanies.map(company => {
            const existing = existingByCompany[company.id]
            const p = placements[company.id]
            return (
              <div key={company.id} className="grid items-center px-4 py-2.5 gap-2"
                style={{ gridTemplateColumns: '2rem 1fr auto auto' }}>
                <span className="text-xs font-bold text-gray-400 tabular-nums">
                  {existing?.placement ?? '—'}
                </span>
                <span className="text-sm font-semibold text-slate-800 truncate">{company.name}</span>
                <span className={`text-sm font-bold tabular-nums ${existing ? 'text-blue-600' : 'text-gray-200'}`}>
                  {existing?.points ?? 0}
                </span>
                <input
                  type="number"
                  min={1}
                  value={p ?? ''}
                  onChange={e => setPlacements(prev => ({ ...prev, [company.id]: e.target.value }))}
                  placeholder="—"
                  className="w-14 text-center text-sm rounded-lg border border-gray-200 px-2 py-1 text-slate-700 tabular-nums"
                />
              </div>
            )
          })}
        </div>
      </div>
      {saveError && <p className="text-sm text-red-600">{saveError}</p>}
      <button
        onClick={handleSaveAll}
        disabled={saving}
        className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save All Placements'}
      </button>
    </div>
  )
}

// ── Donation scoring (read-only ranking by can count) ────────────────────────

function DonationScoringSection({
  sport,
  companies,
  eventPoints,
}: {
  sport: Sport
  companies: Company[]
  eventPoints: EventPoints[]
}) {
  const { data: donations = [] } = useQuery<DonationCount[]>({
    queryKey: ['donation-counts', sport.id],
    queryFn: () => getDonationCounts({ sport_id: sport.id }),
  })

  const countByCompany = useMemo(
    () => Object.fromEntries(donations.map(d => [d.company_id, d.item_count])),
    [donations],
  )
  const pointsByCompany = useMemo(
    () => Object.fromEntries(
      eventPoints.filter(ep => ep.sport_id === sport.id).map(ep => [ep.company_id, ep.points])
    ),
    [eventPoints, sport.id],
  )

  const sorted = useMemo(
    () =>
      [...companies]
        .map(c => ({ company: c, count: countByCompany[c.id] ?? 0, pts: pointsByCompany[c.id] ?? 0 }))
        .sort((a, b) => b.count - a.count),
    [companies, countByCompany, pointsByCompany],
  )

  const hasAny = sorted.some(r => r.count > 0)

  if (!hasAny) {
    return (
      <p className="text-sm text-gray-400 text-center py-6">
        No donations recorded yet. Enter counts from Enter Results first.
      </p>
    )
  }

  // Assign ranks with ties
  let rank = 1
  const ranked = sorted.map((row, i) => {
    if (i > 0 && row.count < sorted[i - 1].count) rank = i + 1
    return { ...row, rank: row.count > 0 ? rank : null }
  })

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div
          className="grid gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider"
          style={{ gridTemplateColumns: '2rem 1fr auto auto' }}
        >
          <span>#</span><span>Company</span><span className="text-right">Cans</span><span className="text-right">Pts</span>
        </div>
        <div className="divide-y divide-gray-50">
          {ranked.map(row => (
            <div
              key={row.company.id}
              className="grid items-center px-4 py-2.5 gap-2"
              style={{ gridTemplateColumns: '2rem 1fr auto auto' }}
            >
              <span className="text-xs font-bold text-gray-400 tabular-nums">
                {row.rank ?? '—'}
              </span>
              <span className="text-sm font-semibold text-slate-800 truncate">{row.company.name}</span>
              <span className="text-sm tabular-nums text-slate-600 text-right">
                {row.count > 0 ? row.count : '—'}
              </span>
              <span className={`text-sm font-bold tabular-nums text-right ${row.pts > 0 ? 'text-blue-600' : 'text-gray-300'}`}>
                {row.pts}
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-400 text-center">
        Points auto-compute when donations are entered. Top donor: 15 pts · 2nd: 10 pts · ≥ 10 items: 5 pts.
      </p>
    </div>
  )
}

function WaterballScoringSection({
  sport,
  companies,
  teams,
  eventPoints,
}: {
  sport: Sport
  companies: Company[]
  teams: Team[]
  eventPoints: EventPoints[]
}) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { data: matches = [], isLoading: matchesLoading } = useQuery<Match[]>({
    queryKey: ['matches', { sport_id: sport.id }],
    queryFn: () => getMatches({ sport_id: sport.id }),
  })

  const companyByTeam = useMemo(
    () => Object.fromEntries(teams.map(t => [t.id, t.company_id])),
    [teams],
  )

  // Preview only — a company's best-of-its-teams score, mirroring the exact
  // ranking the backend recompute will apply. Not persisted until Save.
  const preview = useMemo(() => {
    const bestByCompany: Record<string, number> = {}
    for (const m of matches) {
      if (!m.home_team_id) continue
      const points = waterballMatchPoints(m)
      if (points == null) continue
      const companyId = companyByTeam[m.home_team_id]
      if (!companyId) continue
      bestByCompany[companyId] = Math.max(points, bestByCompany[companyId] ?? -1)
    }
    const rows = companies
      .map(c => ({ company: c, score: bestByCompany[c.id] ?? null }))
      .filter((r): r is { company: Company; score: number } => r.score != null)
      .sort((a, b) => b.score - a.score)
    let rank = 1
    return rows.map((r, i) => {
      if (i > 0 && r.score !== rows[i - 1].score) rank = i + 1
      return { ...r, rank }
    })
  }, [matches, companies, companyByTeam])

  const savedByCompany = useMemo(
    () => Object.fromEntries(
      eventPoints.filter(ep => ep.sport_id === sport.id).map(ep => [ep.company_id, ep])
    ),
    [eventPoints, sport.id],
  )

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      await recomputeWaterballPoints(sport.id)
      qc.invalidateQueries({ queryKey: ['event-points'] })
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save placements')
    } finally {
      setSaving(false)
    }
  }

  if (matchesLoading) {
    return <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
  }

  if (preview.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-6">
        No results recorded yet. Enter rounds survived from Enter Results first.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        Review, then save to update the leaderboard
      </p>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div
          className="grid gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider"
          style={{ gridTemplateColumns: '2rem 1fr auto auto' }}
        >
          <span>#</span><span>Company</span><span className="text-right">Best</span><span className="text-right">Saved Pts</span>
        </div>
        <div className="divide-y divide-gray-50">
          {preview.map(row => {
            const savedEp = savedByCompany[row.company.id]
            return (
              <div
                key={row.company.id}
                className="grid items-center px-4 py-2.5 gap-2"
                style={{ gridTemplateColumns: '2rem 1fr auto auto' }}
              >
                <span className="text-xs font-bold text-gray-400 tabular-nums">{row.rank}</span>
                <span className="text-sm font-semibold text-slate-800 truncate">{row.company.name}</span>
                <span className="text-sm tabular-nums text-slate-600 text-right">{row.score}</span>
                <span className={`text-sm font-bold tabular-nums text-right ${savedEp ? 'text-blue-600' : 'text-gray-300'}`}>
                  {savedEp?.points ?? '—'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      {saveError && <p className="text-sm text-red-600">{saveError}</p>}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Placements'}
      </button>
      <p className="text-xs text-gray-400 text-center">
        "Best" is each company's best team result so far — the leaderboard only updates once you save.
      </p>
    </div>
  )
}

// ── Executive Golf scoring ────────────────────────────────────────────────────

function GolfScoringSection({
  sport,
  companies,
  teams,
  eventPoints,
}: {
  sport: Sport
  companies: Company[]
  teams: Team[]
  eventPoints: EventPoints[]
}) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { data: matches = [], isLoading: matchesLoading } = useQuery<Match[]>({
    queryKey: ['matches', { sport_id: sport.id }],
    queryFn: () => getMatches({ sport_id: sport.id }),
  })
  const { data: brackets = [] } = useQuery<Bracket[]>({
    queryKey: ['brackets', sport.id],
    queryFn: () => getBrackets(sport.id),
  })

  const companyByTeam = useMemo(
    () => Object.fromEntries(teams.map(t => [t.id, t.company_id])),
    [teams],
  )
  const companyById = useMemo(
    () => Object.fromEntries(companies.map(c => [c.id, c])),
    [companies],
  )

  // Preview only — mirrors the backend recompute (golf_results.py): rank the
  // Round-2 field by lowest total (forfeits last), then list everyone else who
  // competed as participants. Not persisted until Save.
  const preview = useMemo(() => {
    const round2Ids = new Set(brackets.filter(b => b.name === ROUND_2_NAME).map(b => b.id))
    const round2Total: Record<string, number> = {}
    const competed = new Set<string>()
    for (const m of matches) {
      if (!m.home_team_id) continue
      const companyId = companyByTeam[m.home_team_id]
      if (!companyId) continue
      if (golfPlayed(m)) competed.add(companyId)
      if (round2Ids.has(m.bracket_id ?? '')) {
        const total = golfTotal(m)
        if (total != null) round2Total[companyId] = Math.min(total, round2Total[companyId] ?? Infinity)
        else if (m.status === 'forfeit' || m.status === 'double_forfeit')
          round2Total[companyId] = round2Total[companyId] ?? Infinity
      }
    }

    const finalists = Object.keys(round2Total)
      .map(id => ({ company: companyById[id], total: round2Total[id] }))
      .filter(r => r.company)
      .sort((a, b) => a.total - b.total)
    let rank = 1
    const rows = finalists.map((r, i) => {
      if (i > 0 && r.total !== finalists[i - 1].total) rank = i + 1
      return {
        company: r.company,
        rank,
        label: r.total === Infinity ? 'Forfeit' : `${r.total}`,
        finalist: true,
      }
    })

    const participantRank = rows.length + 1
    for (const id of competed) {
      if (id in round2Total) continue
      const company = companyById[id]
      if (!company) continue
      rows.push({ company, rank: participantRank, label: 'R1 only', finalist: false })
    }
    return rows
  }, [matches, brackets, companyByTeam, companyById])

  const savedByCompany = useMemo(
    () => Object.fromEntries(
      eventPoints.filter(ep => ep.sport_id === sport.id).map(ep => [ep.company_id, ep])
    ),
    [eventPoints, sport.id],
  )

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      await recomputeGolfPoints(sport.id)
      qc.invalidateQueries({ queryKey: ['event-points'] })
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save placements')
    } finally {
      setSaving(false)
    }
  }

  if (matchesLoading) {
    return <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
  }

  if (preview.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-6">
        No results recorded yet. Enter hole scores from Enter Results first.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        Review, then save to update the leaderboard
      </p>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div
          className="grid gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider"
          style={{ gridTemplateColumns: '2rem 1fr auto auto' }}
        >
          <span>#</span><span>Company</span><span className="text-right">R2 total</span><span className="text-right">Saved Pts</span>
        </div>
        <div className="divide-y divide-gray-50">
          {preview.map(row => {
            const savedEp = savedByCompany[row.company.id]
            return (
              <div
                key={row.company.id}
                className="grid items-center px-4 py-2.5 gap-2"
                style={{ gridTemplateColumns: '2rem 1fr auto auto' }}
              >
                <span className="text-xs font-bold text-gray-400 tabular-nums">{row.rank}</span>
                <span className="text-sm font-semibold text-slate-800 truncate">{row.company.name}</span>
                <span className={`text-sm tabular-nums text-right ${row.finalist ? 'text-slate-600' : 'text-gray-300'}`}>{row.label}</span>
                <span className={`text-sm font-bold tabular-nums text-right ${savedEp ? 'text-blue-600' : 'text-gray-300'}`}>
                  {savedEp?.points ?? '—'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      {saveError && <p className="text-sm text-red-600">{saveError}</p>}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Placements'}
      </button>
      <p className="text-xs text-gray-400 text-center">
        Ranking is by Round 2 total strokes (lowest wins); everyone else who competed shares the
        participation points. The leaderboard only updates once you save.
      </p>
    </div>
  )
}

// ── Sport detail (scoring UI for one sport) ───────────────────────────────────

function SportScoringDetail({
  sport,
  companies,
  teams,
  eventPoints,
  onBack,
}: {
  sport: Sport
  companies: Company[]
  teams: Team[]
  eventPoints: EventPoints[]
  onBack: () => void
}) {
  const { data: sportBrackets = [] } = useQuery<Bracket[]>({
    queryKey: ['brackets', sport.id],
    queryFn: () => getBrackets(sport.id),
    enabled: sport.bracket_type === 'heats',
  })

  const isDonation = sport.scoring_mode === 'donation_count'
  const isWaterball = sport.scoring_mode === 'water_ball_toss'
  const isGolf = sport.scoring_mode === 'executive_golf'
  const isRelayRace = sport.bracket_type === 'heats' && sportBrackets.length > 0 && !isGolf
  const sportTeams = useMemo(() => teams.filter(t => t.sport_id === sport.id), [teams, sport.id])

  return (
    <div className="p-4 mt-2 space-y-5">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-blue-600 font-medium">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Award Placements
      </button>

      <div>
        <h2 className="text-xl font-bold text-slate-800">
          <span className="mr-2">{getSportIcon(sport.name)}</span>{sport.name}
        </h2>
      </div>

      {isDonation ? (
        <DonationScoringSection sport={sport} companies={companies} eventPoints={eventPoints} />
      ) : isWaterball ? (
        <WaterballScoringSection sport={sport} companies={companies} teams={sportTeams} eventPoints={eventPoints} />
      ) : isGolf ? (
        <GolfScoringSection sport={sport} companies={companies} teams={sportTeams} eventPoints={eventPoints} />
      ) : isRelayRace ? (
        <RelayRaceScoringSection sport={sport} companies={companies} teams={sportTeams} />
      ) : (
        <StandardScoringSection sport={sport} companies={companies} eventPoints={eventPoints} />
      )}
    </div>
  )
}

// ── Main page (sport list) ────────────────────────────────────────────────────

export default function ScoringPage() {
  const [selectedSportId, setSelectedSportId] = useState<string | null>(null)

  const { data: sports = [], isLoading } = useQuery<Sport[]>({
    queryKey: ['sports'],
    queryFn: getSports,
    staleTime: Infinity,
  })

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: getCompanies,
    staleTime: Infinity,
  })

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ['teams'],
    queryFn: () => getTeams(),
    staleTime: Infinity,
  })

  const { data: eventPoints = [] } = useQuery<EventPoints[]>({
    queryKey: ['event-points'],
    queryFn: () => getEventPoints(),
  })

  const placementSports = useMemo(
    () => [...sports].sort((a, b) => a.name.localeCompare(b.name)),
    [sports],
  )

  const placedCountBySport = useMemo(() => {
    const map = new Map<string, number>()
    for (const ep of eventPoints) {
      map.set(ep.sport_id, (map.get(ep.sport_id) ?? 0) + 1)
    }
    return map
  }, [eventPoints])

  const selectedSport = useMemo(
    () => sports.find(s => s.id === selectedSportId) ?? null,
    [sports, selectedSportId],
  )

  if (selectedSport) {
    return (
      <SportScoringDetail
        sport={selectedSport}
        companies={companies}
        teams={teams}
        eventPoints={eventPoints}
        onBack={() => setSelectedSportId(null)}
      />
    )
  }

  if (isLoading) {
    return (
      <div className="p-4 mt-2 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-gray-200 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-4 mt-2 space-y-3">
      <BackLink to="/manage" label="Manage" />
      <h2 className="text-xl font-bold text-slate-800">Award Placements</h2>

      {placementSports.map(sport => {
        const isDonation = sport.scoring_mode === 'donation_count'
        const isWaterball = sport.scoring_mode === 'water_ball_toss'
        const isAuto = isDonation || isWaterball
        const placed = placedCountBySport.get(sport.id) ?? 0
        const subtitle = isDonation
          ? 'Ranked by donation count'
          : isWaterball
          ? 'Ranked by rounds survived'
          : placed === 0 ? 'No placements yet' : `${placed} ${placed === 1 ? 'company' : 'companies'} placed`
        return (
          <button
            key={sport.id}
            onClick={() => setSelectedSportId(sport.id)}
            className="w-full flex items-center gap-3 px-4 py-4 bg-white rounded-xl border border-gray-100 shadow-sm active:bg-gray-50 transition-colors text-left"
          >
            <span className="text-xl leading-none shrink-0">{getSportIcon(sport.name)}</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800 truncate">{sport.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
            </div>
            {!isAuto && placed > 0 && (
              <span className="shrink-0 text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                {placed}
              </span>
            )}
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )
      })}
    </div>
  )
}

