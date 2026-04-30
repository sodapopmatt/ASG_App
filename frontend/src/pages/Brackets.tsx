import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMatches } from '../api/matches'
import { getSports } from '../api/sports'
import { getTeams } from '../api/teams'
import { getCompanies } from '../api/companies'
import { getBrackets } from '../api/brackets'
import type { Match, Team, Company, Sport } from '../types'

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [item[key], item]))
}

function compactLabel(
  teamId: string | null,
  teamMap: Record<string, Team>,
  companyMap: Record<string, Company>,
): string {
  if (!teamId) return 'TBD'
  const team = teamMap[teamId]
  if (!team) return '—'
  const company = companyMap[team.company_id]
  const label = company?.short_id ?? company?.name ?? '?'
  return team.name ? `${label} · ${team.name}` : label
}

function slotLabel(
  teamId: string | null,
  otherTeamId: string | null,
  isDone: boolean,
  teamMap: Record<string, Team>,
  companyMap: Record<string, Company>,
): string {
  if (teamId) return compactLabel(teamId, teamMap, companyMap)
  if (isDone && otherTeamId) return 'Bye'
  if (isDone) return '—'
  return 'TBD'
}

const PHASE_ORDER = ['winners', 'losers', 'finals'] as const

const PHASE_LABELS: Record<string, string> = {
  winners: 'Winners Bracket',
  losers: 'Losers Bracket',
  finals: 'Final',
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function MatchCard({
  match,
  teamMap,
  companyMap,
}: {
  match: Match
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
}) {
  const isLive = match.status === 'in_progress'
  const isDone = match.status === 'completed' || match.status === 'forfeit' || match.status === 'double_forfeit'
  const homeLabel = slotLabel(match.home_team_id, match.away_team_id, isDone, teamMap, companyMap)
  const awayLabel = slotLabel(match.away_team_id, match.home_team_id, isDone, teamMap, companyMap)
  const homeWon = match.winner_id != null && match.winner_id === match.home_team_id
  const awayWon = match.winner_id != null && match.winner_id === match.away_team_id
  const showFooter = isLive || isDone || !!match.locations?.name

  return (
    <div className={`bg-white rounded-xl border-2 shadow-sm overflow-hidden w-48 ${
      isLive ? 'border-amber-400 shadow-amber-100' : 'border-gray-200'
    }`}>
      {/* Home team */}
      <div className={`flex items-center px-3 py-2.5 gap-2 ${homeWon ? 'bg-green-50' : ''}`}>
        <span className={`flex-1 text-sm truncate ${
          homeWon ? 'font-semibold text-green-700'
          : !match.home_team_id ? 'italic text-gray-400'
          : 'font-semibold text-slate-800'
        }`}>
          {homeLabel}
        </span>
        {homeWon && <CheckIcon />}
        {isLive && !homeWon && (
          <span className="shrink-0 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        )}
      </div>

      <div className="border-t border-gray-100" />

      {/* Away team */}
      <div className={`flex items-center px-3 py-2.5 gap-2 ${awayWon ? 'bg-green-50' : ''}`}>
        <span className={`flex-1 text-sm truncate ${
          awayWon ? 'font-semibold text-green-700'
          : !match.away_team_id ? 'italic text-gray-400'
          : 'font-semibold text-slate-800'
        }`}>
          {awayLabel}
        </span>
        {awayWon && <CheckIcon />}
        {isLive && !awayWon && (
          <span className="shrink-0 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        )}
      </div>

      {/* Footer: location + status */}
      {showFooter && (
        <div className="border-t border-gray-100 px-3 py-1.5 bg-gray-50 flex items-center justify-between gap-2">
          <span className="text-xs text-gray-400 truncate">{match.locations?.name ?? ''}</span>
          {isLive ? (
            <span className="text-xs font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full animate-pulse shrink-0">
              Live
            </span>
          ) : isDone ? (
            <span className="text-xs text-gray-400 shrink-0">
              {match.status === 'double_forfeit' ? 'Dbl Forfeit' : match.status === 'forfeit' ? 'Forfeit' : 'Final'}
            </span>
          ) : null}
        </div>
      )}
    </div>
  )
}

function RoundColumn({
  label,
  matches,
  teamMap,
  companyMap,
}: {
  label: string | null
  matches: Match[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
}) {
  return (
    <div className="flex flex-col gap-3 w-48">
      {/* Fixed-height header so all columns align even when some have no label */}
      <div className="h-6 flex items-center justify-center">
        {label && (
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {matches.map(match => (
          <MatchCard key={match.id} match={match} teamMap={teamMap} companyMap={companyMap} />
        ))}
      </div>
    </div>
  )
}

type LabelMode = 'rounds' | 'finale' | 'flat'

function BracketPhase({
  title,
  roundMap,
  labelMode,
  teamMap,
  companyMap,
}: {
  title?: string
  roundMap: Map<number, Match[]>
  labelMode: LabelMode
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
}) {
  const entries = [...roundMap.entries()]
  const total = entries.length

  function getLabel(round: number, idx: number, matchCount: number): string | null {
    if (labelMode === 'finale') return null
    if (labelMode === 'flat') {
      if (round === 0) return 'Unassigned'
      if (idx === total - 1 && matchCount === 1) return 'Final'
    }
    return `Round ${round}`
  }

  return (
    <div>
      {title && (
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider border-b border-gray-200 pb-2 mb-4">
          {title}
        </h3>
      )}
      <div className="overflow-x-auto -mx-4 px-4">
        <div className="flex gap-5 pb-4" style={{ minWidth: 'max-content' }}>
          {entries.map(([round, matches], idx) => (
            <RoundColumn
              key={round}
              label={getLabel(round, idx, matches.length)}
              matches={matches}
              teamMap={teamMap}
              companyMap={companyMap}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function formatHeatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  const millis = ms % 1000
  return `${m}:${String(s).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

function HeatsStandingsView({
  matches,
  teamMap,
  companyMap,
}: {
  matches: Match[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
}) {
  const rows = useMemo(() => {
    const completed = matches
      .filter(m => m.status === 'completed' && m.notes)
      .map(m => ({ match: m, ms: parseInt(m.notes!, 10) }))
      .filter(r => !isNaN(r.ms))
      .sort((a, b) => a.ms - b.ms)

    const forfeited = matches.filter(m => m.status === 'forfeit')
    const pending   = matches.filter(m => m.status === 'scheduled' || m.status === 'in_progress')

    return [
      ...completed.map((r, i) => ({ match: r.match, rank: i + 1, ms: r.ms, state: 'done' as const })),
      ...forfeited.map(m  => ({ match: m,  rank: null, ms: null, state: 'forfeit' as const })),
      ...pending.map(m    => ({ match: m,  rank: null, ms: null, state: 'pending' as const })),
    ]
  }, [matches])

  function teamName(teamId: string | null | undefined) {
    if (!teamId) return '—'
    const team = teamMap[teamId]
    if (!team) return '—'
    const company = companyMap[team.company_id]
    const base = company?.name ?? 'Unknown'
    return team.name ? `${base} · ${team.name}` : base
  }

  if (rows.length === 0) {
    return <p className="text-center text-gray-500 py-12">No results yet.</p>
  }

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 grid text-xs font-semibold text-gray-400 uppercase tracking-wider"
        style={{ gridTemplateColumns: '2.5rem 1fr auto' }}>
        <span>Rank</span>
        <span>Team</span>
        <span>Time</span>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(({ match, rank, ms, state }) => (
          <div
            key={match.id}
            className="grid items-center px-4 py-3 gap-3"
            style={{ gridTemplateColumns: '2.5rem 1fr auto' }}
          >
            <span className={`font-bold text-sm text-center ${
              state === 'done' ? 'text-slate-700' : 'text-gray-300'
            }`}>
              {state === 'done' ? rank : '—'}
            </span>
            <span className="text-sm font-medium text-slate-700 truncate">
              {teamName(match.home_team_id)}
            </span>
            {state === 'done' && (
              <span className="font-mono text-sm text-slate-700">{formatHeatTime(ms!)}</span>
            )}
            {state === 'forfeit' && (
              <span className="text-xs text-gray-400">Forfeit</span>
            )}
            {state === 'pending' && (
              <span className="text-xs text-blue-400">TBD</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="p-4 mt-2 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-gray-200 animate-pulse" />
      ))}
    </div>
  )
}

export default function BracketView() {
  const matchesQuery   = useQuery({ queryKey: ['matches'],   queryFn: () => getMatches() })
  const sportsQuery    = useQuery({ queryKey: ['sports'],    queryFn: getSports,        staleTime: Infinity })
  const teamsQuery     = useQuery({ queryKey: ['teams'],     queryFn: () => getTeams(), staleTime: Infinity })
  const companiesQuery = useQuery({ queryKey: ['companies'], queryFn: getCompanies,     staleTime: Infinity })

  const teamMap    = useMemo(() => indexBy(teamsQuery.data    ?? [], 'id') as Record<string, Team>,    [teamsQuery.data])
  const companyMap = useMemo(() => indexBy(companiesQuery.data ?? [], 'id') as Record<string, Company>, [companiesQuery.data])

  const sports = sportsQuery.data ?? []
  const [selectedSportId, setSelectedSportId] = useState<string | null>(null)
  const activeSportId = selectedSportId ?? sports[0]?.id ?? null
  const activeSport: Sport | undefined = useMemo(
    () => sports.find(s => s.id === activeSportId),
    [sports, activeSportId],
  )
  const isHeats = activeSport?.bracket_type === 'heats'

  // Fetch brackets for the active sport to resolve bracket_phase per match.
  // bracket_phase lives on the brackets table, not on matches, so we join client-side
  // via match.bracket_id → bracketPhaseMap[bracket_id].
  const bracketsQuery = useQuery({
    queryKey: ['brackets', activeSportId],
    queryFn: () => getBrackets(activeSportId!),
    enabled: !!activeSportId,
    staleTime: Infinity,
  })

  const bracketPhaseMap = useMemo((): Record<string, string> => {
    const map: Record<string, string> = {}
    for (const b of (bracketsQuery.data ?? [])) {
      if (b.phase) map[b.id] = b.phase
    }
    return map
  }, [bracketsQuery.data])

  const matchesBySport = useMemo(() => {
    const map = new Map<string, Match[]>()
    for (const m of (matchesQuery.data ?? [])) {
      const list = map.get(m.sport_id) ?? []
      list.push(m)
      map.set(m.sport_id, list)
    }
    return map
  }, [matchesQuery.data])

  // Group by bracket phase (resolved via bracketPhaseMap) → match_round → matches.
  // Rounds are sorted ascending within each phase so round numbers are independent per phase.
  const phaseGroups = useMemo((): Map<string, Map<number, Match[]>> => {
    if (!activeSportId) return new Map()
    const sportMatches = matchesBySport.get(activeSportId) ?? []
    const result = new Map<string, Map<number, Match[]>>()
    for (const m of sportMatches) {
      const phase = (m.bracket_id ? bracketPhaseMap[m.bracket_id] : null) ?? 'unassigned'
      const round = m.match_round ?? 0
      if (!result.has(phase)) result.set(phase, new Map())
      const roundMap = result.get(phase)!
      const list = roundMap.get(round) ?? []
      list.push(m)
      roundMap.set(round, list)
    }
    for (const phase of [...result.keys()]) {
      const roundMap = result.get(phase)!
      result.set(phase, new Map([...roundMap.entries()].sort(([a], [b]) => a - b)))
    }
    return result
  }, [activeSportId, matchesBySport, bracketPhaseMap])

  // hasPhases is true only when DE phases (winners/losers/finals) are present.
  // Single elimination uses phase="bracket" which falls through to the flat view.
  const orderedPhases = PHASE_ORDER.filter(p => phaseGroups.has(p))
  const hasPhases = orderedPhases.length > 0

  // Flat view: merge all rounds across all phases into one map, sorted ascending.
  // Used for single elimination and any sport without explicit DE phases.
  const flatRoundMap = useMemo((): Map<number, Match[]> => {
    const map = new Map<number, Match[]>()
    for (const roundMap of phaseGroups.values()) {
      for (const [round, matches] of roundMap) {
        map.set(round, [...(map.get(round) ?? []), ...matches])
      }
    }
    return new Map([...map.entries()].sort(([a], [b]) => a - b))
  }, [phaseGroups])

  const hasMatches = phaseGroups.size > 0

  const isLoading =
    matchesQuery.isLoading ||
    sportsQuery.isLoading ||
    teamsQuery.isLoading ||
    companiesQuery.isLoading ||
    bracketsQuery.isLoading

  if (isLoading) return <Skeleton />

  if (sports.length === 0) {
    return <p className="text-center text-gray-500 py-16">No sports found.</p>
  }

  return (
    <div className="p-4 mt-2">
      {/* Sport tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-4 px-4 no-scrollbar">
        {sports.map(sport => (
          <button
            key={sport.id}
            onClick={() => setSelectedSportId(sport.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeSportId === sport.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {sport.name}
          </button>
        ))}
      </div>

      {isHeats ? (
        <HeatsStandingsView
          matches={matchesBySport.get(activeSportId!) ?? []}
          teamMap={teamMap}
          companyMap={companyMap}
        />
      ) : !hasMatches ? (
        <p className="text-center text-gray-500 py-12">No matches for this sport yet.</p>
      ) : hasPhases ? (
        <div className="space-y-8">
          {orderedPhases.map(phase => (
            <BracketPhase
              key={phase}
              title={PHASE_LABELS[phase] ?? phase}
              roundMap={phaseGroups.get(phase)!}
              labelMode={phase === 'finals' ? 'finale' : 'rounds'}
              teamMap={teamMap}
              companyMap={companyMap}
            />
          ))}
        </div>
      ) : (
        <BracketPhase
          roundMap={flatRoundMap}
          labelMode="flat"
          teamMap={teamMap}
          companyMap={companyMap}
        />
      )}
    </div>
  )
}
