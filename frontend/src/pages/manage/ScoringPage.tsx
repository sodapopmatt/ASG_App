import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSports, getStandings, getChampionshipStandings } from '../../api/sports'
import type { PoolStandings, ChampionshipStandings } from '../../api/sports'
import { getTeams } from '../../api/teams'
import { getCompanies } from '../../api/companies'
import { getMatches } from '../../api/matches'
import { getBrackets } from '../../api/brackets'
import { getEventPoints, awardPlacement, clearEventPoints } from '../../api/event_points'
import { getDonationCounts } from '../../api/donation_counts'
import { recomputeWaterballPoints } from '../../api/waterball_results'
import { getSportIcon } from '../../lib/sportIcons'
import type { Sport, Company, EventPoints, Match, Bracket, Team, DonationCount } from '../../types'
import { waterballMatchPoints } from '../../lib/waterball'
import { ROUND_2_NAME, golfTotal, golfPlayed } from '../../lib/golf'
import {
  scalePoints,
  defaultPoints,
  collapseToCompanies,
  buildManualRows,
  rankSingleElim,
  rankDoubleElim,
  rankPoolBracket,
  rankPoolSwiss,
  rankFlatHeats,
  rankRelayHeats,
} from '../../lib/ranking'
import type { CompanyRow, TieGroup } from '../../lib/ranking'

const ChevronDownIcon = ({ open }: { open: boolean }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className={`transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

// Runs `fn` over `items` with at most `limit` requests in flight at once —
// firing dozens of writes fully in parallel can overwhelm the connection
// (browser per-origin limits, or the backend under a burst of concurrent
// writes) and one failure aborts everything with Promise.all; this stays
// fast without risking a "Failed to fetch" from an all-at-once burst, and
// one row failing doesn't take the rest down with it.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// A batch of ~40 companies over a real (sometimes flaky) network can lose a
// handful of individual requests even at modest concurrency — retry each one
// a couple of times with a short pause before giving up on it.
async function withRetries<T>(fn: () => Promise<T>, retries = 2, delayMs = 500): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

// ── Auto-ranked scoring (all match-based sports) ──────────────────────────────

// The Executive Golf UX generalized: rows default to an auto-computed ranking,
// each row unlocks for a placement or points override, and Publish writes
// every row via award-placement with its exact points.
function AutoRankedScoringSection({
  sport,
  rows,
  eventPoints,
  footnote,
}: {
  sport: Sport
  rows: CompanyRow[]
  eventPoints: EventPoints[]
  footnote: string
}) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  // Overrides: companyId → placement (defaults to the auto-computed rank)
  const [overrides, setOverrides] = useState<Record<string, number | null>>({})
  // Points overrides: companyId → explicit points, bypassing the scale for
  // that one company. null/absent = derive from placement (the default).
  const [pointsOverrides, setPointsOverrides] = useState<Record<string, number | null>>({})
  // Rows start locked (greyed, non-interactive) showing the auto-computed
  // default; "Edit" unlocks both fields for a manual override.
  const [editingRows, setEditingRows] = useState<Set<string>>(new Set())
  // Per-team breakdown for multi-team companies — collapsed by default.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // What actually got saved last time — the baseline default, so a save
  // survives navigating away and back rather than resetting to a fresh
  // auto-computed guess every time this section remounts.
  const savedByCompany = useMemo(
    () => Object.fromEntries(
      eventPoints.filter(ep => ep.sport_id === sport.id).map(ep => [ep.company_id, ep])
    ),
    [eventPoints, sport.id],
  )

  function getPlacement(row: CompanyRow): number | null {
    if (overrides[row.companyId] !== undefined) return overrides[row.companyId]
    return savedByCompany[row.companyId]?.placement ?? row.placement
  }

  function getPoints(row: CompanyRow): number {
    if (pointsOverrides[row.companyId] != null) return pointsOverrides[row.companyId]!
    if (savedByCompany[row.companyId]) return savedByCompany[row.companyId].points
    const p = getPlacement(row)
    if (p === null) return 0
    // An untouched placement keeps its tie-aware default (tied places share
    // averaged points); a manually overridden one derives straight from the
    // scale for that place.
    if (p === row.placement) return defaultPoints(row, sport.points_scale)
    return scalePoints(p, sport.points_scale)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const results = await mapWithConcurrency(rows, 3, row => {
        const p = getPlacement(row)
        if (p === null) return Promise.resolve(null)
        // Always send the exact points currently shown (whether that's a
        // fresh auto default, a prior save, or a new override) — otherwise
        // re-saving a row nobody touched this session could silently revert
        // a previously-saved custom points value back to the scale default.
        return withRetries(() => awardPlacement(row.companyId, sport.id, p, undefined, getPoints(row)))
      })
      qc.invalidateQueries({ queryKey: ['event-points'] })
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
      const failedNames = results
        .map((r, i) => (r.status === 'rejected' ? rows[i].companyName : null))
        .filter((n): n is string => n !== null)
      if (failedNames.length > 0) {
        const shown = failedNames.slice(0, 5).join(', ')
        const more = failedNames.length > 5 ? ` and ${failedNames.length - 5} more` : ''
        setSaveError(`Failed to publish ${failedNames.length} of ${rows.length}: ${shown}${more}. It's safe to click Publish Standings again.`)
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save placements')
    } finally {
      setSaving(false)
    }
  }

  async function handleResetToDefaults() {
    if (!window.confirm(
      'Clear all saved points for this sport? This zeroes out its contribution to the leaderboard/Standings ' +
      'page entirely — every company shows no points until you save placements again.'
    )) return
    setOverrides({})
    setPointsOverrides({})
    setEditingRows(new Set())
    setSaveError(null)

    setResetting(true)
    try {
      await withRetries(() => clearEventPoints(sport.id))
      await qc.invalidateQueries({ queryKey: ['event-points'] })
      await qc.invalidateQueries({ queryKey: ['leaderboard'] })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to reset placements')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Auto-computed placements
        </p>
        <p className="text-xs text-gray-400">Edit placement or points to override</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div
          className="grid gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider"
          style={{ gridTemplateColumns: '2rem 1fr 3rem 3.5rem 3.5rem' }}
        >
          <span>#</span><span>Company</span><span></span><span className="text-right">Place</span><span className="text-right">Pts</span>
        </div>
        <div className="divide-y divide-gray-50">
          {rows.map(row => {
            const p = getPlacement(row)
            const pts = getPoints(row)
            const editing = editingRows.has(row.companyId)
            const hasOtherTeams = row.otherTeams.length > 0
            const expanded = expandedRows.has(row.companyId)
            return (
              <div key={row.companyId}>
                <div
                  className="grid items-center px-4 py-2.5 gap-2"
                  style={{ gridTemplateColumns: '2rem 1fr 3rem 3.5rem 3.5rem' }}
                >
                  <span className="text-xs font-bold text-gray-400 tabular-nums">{p ?? '—'}</span>
                  {hasOtherTeams ? (
                    <button
                      type="button"
                      onClick={() => setExpandedRows(prev => {
                        const next = new Set(prev)
                        if (expanded) next.delete(row.companyId)
                        else next.add(row.companyId)
                        return next
                      })}
                      className="min-w-0 flex items-center gap-2 text-left"
                    >
                      <ChevronDownIcon open={expanded} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 truncate flex items-center gap-1.5">
                          <span className="truncate">{row.companyName}</span>
                          <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">
                            {row.otherTeams.length + 1}
                          </span>
                          {row.forfeited && (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 shrink-0">
                              Forfeit
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400 truncate">{row.detail}</p>
                      </div>
                    </button>
                  ) : (
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="shrink-0 inline-block" style={{ width: 14 }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {row.companyName}
                          {row.forfeited && (
                            <span className="ml-1.5 align-middle text-[10px] font-bold text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
                              Forfeit
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400 truncate">{row.detail}</p>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingRows(prev => {
                      const next = new Set(prev)
                      if (editing) next.delete(row.companyId)
                      else next.add(row.companyId)
                      return next
                    })}
                    className="text-xs font-semibold text-blue-600 justify-self-end"
                  >
                    {editing ? 'Done' : 'Edit'}
                  </button>
                  <input
                    type="number"
                    min={1}
                    disabled={!editing}
                    value={p ?? ''}
                    onChange={e => {
                      const val = e.target.value === '' ? null : Number(e.target.value)
                      setOverrides(prev => ({ ...prev, [row.companyId]: val }))
                    }}
                    placeholder="—"
                    className="w-14 text-center text-sm rounded-lg border border-gray-200 px-2 py-1 text-slate-700 tabular-nums justify-self-end disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-100"
                  />
                  <input
                    type="number"
                    disabled={!editing}
                    value={pts}
                    onChange={e => {
                      const val = e.target.value === '' ? null : Number(e.target.value)
                      setPointsOverrides(prev => ({ ...prev, [row.companyId]: val }))
                    }}
                    className={`w-14 text-center text-sm rounded-lg border border-gray-200 px-2 py-1 tabular-nums font-bold justify-self-end disabled:bg-gray-100 disabled:border-gray-100 ${pts > 0 ? 'text-blue-600' : 'text-gray-400'} disabled:text-gray-400`}
                  />
                </div>
                {expanded && hasOtherTeams && (
                  <div className="px-4 pb-2.5 pl-[3.25rem] space-y-1">
                    {row.otherTeams.map((t, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg border border-gray-200 px-3 py-1.5"
                      >
                        <span className="text-xs font-medium text-slate-600">{t.teamName}</span>
                        <span className="text-xs text-gray-400">{t.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {saveError && <p className="text-sm text-red-600">{saveError}</p>}
      <p className="text-xs text-gray-400 text-center">{footnote}</p>
      <div className="flex gap-2">
        <button
          onClick={handleResetToDefaults}
          disabled={saving || resetting}
          className="py-2 px-4 rounded-lg border border-red-200 text-red-600 font-semibold text-sm hover:bg-red-50 disabled:opacity-50"
        >
          {resetting ? 'Clearing…' : 'Clear Points'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || resetting}
          className="flex-1 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Publishing…' : saved ? 'Published ✓' : 'Publish Standings'}
        </button>
      </div>
    </div>
  )
}

const RANKING_FOOTNOTES: Record<string, string> = {
  single_elimination:
    'Ranking comes from the bracket: champion first, then teams by the round they went out in — same-round exits are tied and share averaged points. Only a company\'s best team scores. Apply the −10 no-show deduction to a flagged forfeit by editing its points. The leaderboard only updates once you publish.',
  double_elimination:
    'Ranking comes from the bracket: grand final first, then teams by the losers-bracket round they went out in — same-round exits are tied and share averaged points. Only a company\'s best team scores. Apply the −10 no-show deduction to a flagged forfeit by editing its points. The leaderboard only updates once you publish.',
  pool_bracket:
    'Bracket finishers rank first, then pool-stage teams by W–L record — identical records are tied and share averaged points. Only a company\'s best team scores. The leaderboard only updates once you publish.',
  pool_swiss:
    'Championship finishers rank first, then pool-stage teams by tournament points — identical records are tied and share averaged points. Only a company\'s best team scores. The leaderboard only updates once you publish.',
  heats:
    'Ranking is by how far each team advanced and its recorded times; forfeits default to 0 points. The leaderboard only updates once you publish.',
}

// Fetches whatever the sport's bracket type needs (matches, brackets, pool or
// championship standings), computes the suggested final ranking client-side,
// and hands it to the editable table above. Falls back to the manual entry
// form until the sport has anything to rank.
function ComputedScoringSection({
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
  const isPoolType = sport.bracket_type === 'pool_bracket' || sport.bracket_type === 'pool_swiss'

  const { data: matches = [], isLoading: matchesLoading } = useQuery<Match[]>({
    queryKey: ['matches', { sport_id: sport.id }],
    queryFn: () => getMatches({ sport_id: sport.id }),
  })
  const { data: brackets = [] } = useQuery<Bracket[]>({
    queryKey: ['brackets', sport.id],
    queryFn: () => getBrackets(sport.id),
  })
  const { data: standings = [] } = useQuery<PoolStandings[]>({
    queryKey: ['standings', sport.id],
    queryFn: () => getStandings(sport.id),
    enabled: isPoolType,
  })
  const { data: championship } = useQuery<ChampionshipStandings>({
    queryKey: ['championship-standings', sport.id],
    queryFn: () => getChampionshipStandings(sport.id),
    enabled: sport.bracket_type === 'pool_swiss',
  })

  const rows = useMemo(() => {
    const phaseByBracket: Record<string, string | null> = Object.fromEntries(brackets.map(b => [b.id, b.phase]))
    let groups: TieGroup[]
    switch (sport.bracket_type) {
      case 'single_elimination':
        groups = rankSingleElim(matches, phaseByBracket)
        break
      case 'double_elimination':
        groups = rankDoubleElim(matches, phaseByBracket)
        break
      case 'pool_bracket':
        groups = rankPoolBracket(matches, brackets, standings)
        break
      case 'pool_swiss':
        groups = rankPoolSwiss(standings, championship ?? null)
        break
      case 'heats':
        groups = brackets.length > 0
          ? rankRelayHeats(brackets, matches)
          : rankFlatHeats(matches, sport.scoring_direction)
        break
      default:
        groups = []
    }
    return collapseToCompanies(groups, teams, companies)
  }, [sport.bracket_type, sport.scoring_direction, matches, brackets, standings, championship, teams, companies])

  if (matchesLoading) {
    return <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
  }

  const savedByCompany = Object.fromEntries(
    eventPoints.filter(ep => ep.sport_id === sport.id).map(ep => [ep.company_id, ep])
  )
  const displayRows = rows.length > 0 ? rows : buildManualRows(companies, savedByCompany)
  const footnote = rows.length > 0
    ? (RANKING_FOOTNOTES[sport.bracket_type] ?? 'The leaderboard only updates once you publish.')
    : 'No results recorded yet — enter placements manually below. The leaderboard only updates once you publish.'

  return (
    <AutoRankedScoringSection
      sport={sport}
      rows={displayRows}
      eventPoints={eventPoints}
      footnote={footnote}
    />
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
    const scored = companies
      .map(c => ({ company: c, score: bestByCompany[c.id] ?? null }))
      .filter((r): r is { company: Company; score: number } => r.score != null)
      .sort((a, b) => b.score - a.score)
    let rank = 1
    const rankedRows = scored.map((r, i) => {
      if (i > 0 && r.score !== scored[i - 1].score) rank = i + 1
      return { ...r, rank: rank as number | null }
    })
    // Companies with no result at all yet — show as blank rows, same as
    // sports with no matches yet (ComputedScoringSection's buildManualRows).
    const scoredIds = new Set(rankedRows.map(r => r.company.id))
    const blanks = companies
      .filter(c => !scoredIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => ({ company: c, score: null as number | null, rank: null as number | null }))
    return [...rankedRows, ...blanks]
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
                <span className="text-xs font-bold text-gray-400 tabular-nums">{row.rank ?? '—'}</span>
                <span className="text-sm font-semibold text-slate-800 truncate">{row.company.name}</span>
                <span className="text-sm tabular-nums text-slate-600 text-right">{row.score ?? '—'}</span>
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
// (scalePoints now lives in lib/ranking.ts, shared with the auto-ranked sections)

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
  const [resetting, setResetting] = useState(false)
  // Overrides: companyId → placement (defaults to the auto-computed rank below)
  const [overrides, setOverrides] = useState<Record<string, number | null>>({})
  // Points overrides: companyId → explicit points, bypassing the scale for
  // that one company. null/absent = derive from placement (the default).
  const [pointsOverrides, setPointsOverrides] = useState<Record<string, number | null>>({})
  // Rows start locked (greyed, non-interactive) showing the auto-computed
  // default; "Edit" unlocks both fields for a manual override.
  const [editingRows, setEditingRows] = useState<Set<string>>(new Set())

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

  // Auto-computed default ranking — mirrors the backend recompute
  // (golf_results.py): rank the Round-2 field by lowest total (forfeits
  // last), then list everyone else who competed as participants. This is
  // only the starting point; admins can override any row's placement below.
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
    const rows: { company: Company; rank: number | null; label: string; finalist: boolean }[] = finalists.map((r, i) => {
      if (i > 0 && r.total !== finalists[i - 1].total) rank = i + 1
      return {
        company: r.company,
        rank,
        label: r.total === Infinity ? 'Forfeit' : `${r.total} strokes`,
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

    // Companies with no result at all yet — show as blank rows, same as
    // sports with no matches yet (ComputedScoringSection's buildManualRows).
    const accounted = new Set(rows.map(r => r.company.id))
    const blanks = companies
      .filter(c => !accounted.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const company of blanks) {
      rows.push({ company, rank: null, label: 'No results yet', finalist: false })
    }
    return rows
  }, [matches, brackets, companies, companyByTeam, companyById])

  // What actually got saved last time — the baseline default, so a save
  // survives navigating away and back rather than resetting to a fresh
  // auto-computed guess every time this section remounts.
  const savedByCompany = useMemo(
    () => Object.fromEntries(
      eventPoints.filter(ep => ep.sport_id === sport.id).map(ep => [ep.company_id, ep])
    ),
    [eventPoints, sport.id],
  )

  function getPlacement(row: (typeof preview)[number]): number | null {
    if (overrides[row.company.id] !== undefined) return overrides[row.company.id]
    return savedByCompany[row.company.id]?.placement ?? row.rank
  }

  // Points default to the placement-derived scale value; an explicit
  // override replaces that for this one company only (a manual exception,
  // not the normal path — see award_placement's `points` param).
  function getPoints(row: (typeof preview)[number]): number {
    if (pointsOverrides[row.company.id] != null) return pointsOverrides[row.company.id]!
    if (savedByCompany[row.company.id]) return savedByCompany[row.company.id].points
    const p = getPlacement(row)
    return p === null ? 0 : scalePoints(p, sport.points_scale)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const results = await mapWithConcurrency(preview, 3, row => {
        const p = getPlacement(row)
        if (p === null) return Promise.resolve(null)
        // Always send the exact points currently shown (whether that's a
        // fresh auto default, a prior save, or a new override) — otherwise
        // re-saving a row nobody touched this session could silently revert
        // a previously-saved custom points value back to the scale default.
        return withRetries(() => awardPlacement(row.company.id, sport.id, p, undefined, getPoints(row)))
      })
      qc.invalidateQueries({ queryKey: ['event-points'] })
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
      const failedNames = results
        .map((r, i) => (r.status === 'rejected' ? preview[i].company.name : null))
        .filter((n): n is string => n !== null)
      if (failedNames.length > 0) {
        const shown = failedNames.slice(0, 5).join(', ')
        const more = failedNames.length > 5 ? ` and ${failedNames.length - 5} more` : ''
        setSaveError(`Failed to publish ${failedNames.length} of ${preview.length}: ${shown}${more}. It's safe to click Publish Standings again.`)
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save placements')
    } finally {
      setSaving(false)
    }
  }

  async function handleResetToDefaults() {
    if (!window.confirm(
      'Clear all saved points for this sport? This zeroes out its contribution to the leaderboard/Standings ' +
      'page entirely — every company shows no points until you save placements again.'
    )) return
    // Wipe event_points for this sport in ONE request, then discard local
    // overrides so the table falls back to the fresh, unsaved auto-computed
    // preview (no savedByCompany rows left to read from).
    setOverrides({})
    setPointsOverrides({})
    setEditingRows(new Set())
    setSaveError(null)

    setResetting(true)
    try {
      await withRetries(() => clearEventPoints(sport.id))
      await qc.invalidateQueries({ queryKey: ['event-points'] })
      await qc.invalidateQueries({ queryKey: ['leaderboard'] })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to reset placements')
    } finally {
      setResetting(false)
    }
  }

  if (matchesLoading) {
    return <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Auto-computed placements
        </p>
        <p className="text-xs text-gray-400">Edit placement or points to override</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div
          className="grid gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider"
          style={{ gridTemplateColumns: '2rem 1fr 3rem 3.5rem 3.5rem' }}
        >
          <span>#</span><span>Company</span><span></span><span className="text-right">Place</span><span className="text-right">Pts</span>
        </div>
        <div className="divide-y divide-gray-50">
          {preview.map(row => {
            const p = getPlacement(row)
            const pts = getPoints(row)
            const editing = editingRows.has(row.company.id)
            return (
              <div
                key={row.company.id}
                className="grid items-center px-4 py-2.5 gap-2"
                style={{ gridTemplateColumns: '2rem 1fr 3rem 3.5rem 3.5rem' }}
              >
                <span className="text-xs font-bold text-gray-400 tabular-nums">{p ?? '—'}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{row.company.name}</p>
                  <p className={`text-xs truncate ${row.finalist ? 'text-gray-400' : 'text-gray-300'}`}>{row.label}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingRows(prev => {
                    const next = new Set(prev)
                    if (editing) next.delete(row.company.id)
                    else next.add(row.company.id)
                    return next
                  })}
                  className="text-xs font-semibold text-blue-600 justify-self-end"
                >
                  {editing ? 'Done' : 'Edit'}
                </button>
                <input
                  type="number"
                  min={1}
                  disabled={!editing}
                  value={p ?? ''}
                  onChange={e => {
                    const val = e.target.value === '' ? null : Number(e.target.value)
                    setOverrides(prev => ({ ...prev, [row.company.id]: val }))
                  }}
                  placeholder="—"
                  className="w-14 text-center text-sm rounded-lg border border-gray-200 px-2 py-1 text-slate-700 tabular-nums justify-self-end disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-100"
                />
                <input
                  type="number"
                  min={0}
                  disabled={!editing}
                  value={pts}
                  onChange={e => {
                    const val = e.target.value === '' ? null : Number(e.target.value)
                    setPointsOverrides(prev => ({ ...prev, [row.company.id]: val }))
                  }}
                  className={`w-14 text-center text-sm rounded-lg border border-gray-200 px-2 py-1 tabular-nums font-bold justify-self-end disabled:bg-gray-100 disabled:border-gray-100 ${pts > 0 ? 'text-blue-600' : 'text-gray-400'} disabled:text-gray-400`}
                />
              </div>
            )
          })}
        </div>
      </div>
      {saveError && <p className="text-sm text-red-600">{saveError}</p>}
      <p className="text-xs text-gray-400 text-center">
        Ranking is by Round 2 total strokes (lowest wins); everyone else who competed defaults to
        the participation placement. The leaderboard only updates once you publish.
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleResetToDefaults}
          disabled={saving || resetting}
          className="py-2 px-4 rounded-lg border border-red-200 text-red-600 font-semibold text-sm hover:bg-red-50 disabled:opacity-50"
        >
          {resetting ? 'Clearing…' : 'Clear Points'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || resetting}
          className="flex-1 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Publishing…' : saved ? 'Published ✓' : 'Publish Standings'}
        </button>
      </div>
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
  const isDonation = sport.scoring_mode === 'donation_count'
  const isWaterball = sport.scoring_mode === 'water_ball_toss'
  const isGolf = sport.scoring_mode === 'executive_golf'
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
      ) : (
        <ComputedScoringSection sport={sport} companies={companies} teams={sportTeams} eventPoints={eventPoints} />
      )}
    </div>
  )
}

// ── Main page (sport list) ────────────────────────────────────────────────────

export default function ScoringPage() {
  const { sportId: selectedSportId } = useParams<{ sportId?: string }>()
  const navigate = useNavigate()

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
        onBack={() => navigate('/manage/scoring')}
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
            onClick={() => navigate(`/manage/scoring/${sport.id}`)}
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

