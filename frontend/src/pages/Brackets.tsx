import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  SingleEliminationBracket,
  DoubleEliminationBracket,
  Match as LibMatch,
} from '@g-loot/react-tournament-brackets'
import type { MatchType, MatchComponentProps } from '@g-loot/react-tournament-brackets'
import { getMatches } from '../api/matches'
import { getSports } from '../api/sports'
import { getTeams } from '../api/teams'
import { getCompanies } from '../api/companies'
import { getBrackets } from '../api/brackets'
import type { Match, Team, Company, Sport } from '../types'
import { toLibraryMatch, stableSortMatches, lightTheme, bracketOptions, ScrollSvg, DoubleScrollSvg, compactLabel } from '../lib/bracketHelpers'

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [item[key], item]))
}

// ---- Heats standings -------------------------------------------------------

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
      ...forfeited.map(m => ({ match: m, rank: null, ms: null, state: 'forfeit' as const })),
      ...pending.map(m   => ({ match: m, rank: null, ms: null, state: 'pending' as const })),
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

  if (rows.length === 0) return <p className="text-center text-gray-500 py-12">No results yet.</p>

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 grid text-xs font-semibold text-gray-400 uppercase tracking-wider"
        style={{ gridTemplateColumns: '2.5rem 1fr auto' }}>
        <span>Rank</span><span>Team</span><span>Time</span>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(({ match, rank, ms, state }) => (
          <div key={match.id} className="grid items-center px-4 py-3 gap-3" style={{ gridTemplateColumns: '2.5rem 1fr auto' }}>
            <span className={`font-bold text-sm text-center ${state === 'done' ? 'text-slate-700' : 'text-gray-300'}`}>
              {state === 'done' ? rank : '—'}
            </span>
            <span className="text-sm font-medium text-slate-700 truncate">{teamName(match.home_team_id)}</span>
            {state === 'done' && <span className="font-mono text-sm text-slate-700">{formatHeatTime(ms!)}</span>}
            {state === 'forfeit' && <span className="text-xs text-gray-400">Forfeit</span>}
            {state === 'pending' && <span className="text-xs text-blue-400">TBD</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Fallback list for pool/swiss/manual -----------------------------------

function FallbackMatchList({
  matches,
  teamMap,
  companyMap,
}: {
  matches: Match[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
}) {
  const sorted = useMemo(
    () => [...matches].sort((a, b) => (a.match_round ?? 0) - (b.match_round ?? 0)),
    [matches],
  )

  if (sorted.length === 0) return <p className="text-center text-gray-500 py-12">No matches for this sport yet.</p>

  return (
    <div className="space-y-2">
      {sorted.map(m => {
        const isDone = m.status === 'completed' || m.status === 'forfeit' || m.status === 'double_forfeit'
        const isLive = m.status === 'in_progress'
        const homeWon = m.winner_id != null && m.winner_id === m.home_team_id
        const awayWon = m.winner_id != null && m.winner_id === m.away_team_id
        const homeLabel = compactLabel(m.home_team_id, teamMap, companyMap, m.home_slot_state)
        const awayLabel = compactLabel(m.away_team_id, teamMap, companyMap, m.away_slot_state)

        return (
          <div key={m.id} className={`bg-white rounded-xl border-2 shadow-sm overflow-hidden ${isLive ? 'border-amber-400' : 'border-gray-200'}`}>
            <div className={`flex items-center px-3 py-2.5 gap-2 ${homeWon ? 'bg-green-50' : ''}`}>
              <span className={`flex-1 text-sm truncate ${homeWon ? 'font-semibold text-green-700' : !m.home_team_id ? 'italic text-gray-400' : 'font-semibold text-slate-800'}`}>{homeLabel}</span>
              {homeWon && <span className="text-green-600 text-xs font-bold">WIN</span>}
              {(m.status === 'double_forfeit' || (m.status === 'forfeit' && m.winner_id !== m.home_team_id)) && m.home_team_id && (
                <span className="text-xs text-red-400 font-medium">FF</span>
              )}
            </div>
            <div className="border-t border-gray-100" />
            <div className={`flex items-center px-3 py-2.5 gap-2 ${awayWon ? 'bg-green-50' : ''}`}>
              <span className={`flex-1 text-sm truncate ${awayWon ? 'font-semibold text-green-700' : !m.away_team_id ? 'italic text-gray-400' : 'font-semibold text-slate-800'}`}>{awayLabel}</span>
              {awayWon && <span className="text-green-600 text-xs font-bold">WIN</span>}
              {(m.status === 'double_forfeit' || (m.status === 'forfeit' && m.winner_id !== m.away_team_id)) && m.away_team_id && (
                <span className="text-xs text-red-400 font-medium">FF</span>
              )}
            </div>
            {(isLive || isDone || m.locations?.name) && (
              <div className="border-t border-gray-100 px-3 py-1.5 bg-gray-50 flex items-center justify-between gap-2">
                <span className="text-xs text-gray-400 truncate">{m.locations?.name ?? ''}</span>
                {isLive ? (
                  <span className="text-xs font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full animate-pulse">Live</span>
                ) : isDone ? (
                  <span className="text-xs text-gray-400">
                    {m.status === 'double_forfeit' ? 'Dbl Forfeit' : m.status === 'forfeit' ? 'Forfeit' : 'Final'}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---- Custom match component ------------------------------------------------

function MatchComponent(props: MatchComponentProps) {
  const isPlaying = props.match.state === 'PLAYING'
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <LibMatch {...props} topText="" onMatchClick={undefined} />
      {isPlaying && (
        <span style={{
          position: 'absolute', top: 4, right: 8,
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 600, color: '#92400e',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          pointerEvents: 'none',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#eab308', display: 'inline-block' }} />
          In Progress
        </span>
      )}
    </div>
  )
}

// ---- Elimination bracket views --------------------------------------------

function SingleBracketView({
  matches,
  teamMap,
  companyMap,
  onMatchClick,
}: {
  matches: Match[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  onMatchClick?: (matchId: string) => void
}) {
  const libMatches = useMemo(
    () => stableSortMatches(matches).map(m => toLibraryMatch(m, teamMap, companyMap)),
    [matches, teamMap, companyMap],
  )

  if (libMatches.length === 0) return <p className="text-center text-gray-500 py-12">No matches yet.</p>

  return (
    <div className="-mx-4 px-4">
      <SingleEliminationBracket
        matches={libMatches}
        matchComponent={MatchComponent}
        theme={lightTheme}
        options={bracketOptions}
        onMatchClick={onMatchClick ? ({ match }) => onMatchClick(String(match.id)) : undefined}
        svgWrapper={({ children, bracketWidth, bracketHeight }) => (
          <ScrollSvg bracketWidth={bracketWidth} bracketHeight={bracketHeight}>{children}</ScrollSvg>
        )}
      />
    </div>
  )
}

function DoubleBracketView({
  matches,
  bracketPhaseMap,
  teamMap,
  companyMap,
  onMatchClick,
}: {
  matches: Match[]
  bracketPhaseMap: Record<string, string>
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  onMatchClick?: (matchId: string) => void
}) {
  const { upper, lower } = useMemo(() => {
    const upper: MatchType[] = []
    const lower: MatchType[] = []
    for (const m of stableSortMatches(matches)) {
      const phase = m.bracket_id ? bracketPhaseMap[m.bracket_id] : null
      const lib = toLibraryMatch(m, teamMap, companyMap)
      if (phase === 'losers') lower.push(lib)
      else upper.push(lib)
    }
    return { upper, lower }
  }, [matches, bracketPhaseMap, teamMap, companyMap])

  if (upper.length === 0 && lower.length === 0) return <p className="text-center text-gray-500 py-12">No matches yet.</p>

  return (
    <div className="-mx-4 px-4">
      <DoubleEliminationBracket
        matches={{ upper, lower }}
        matchComponent={MatchComponent}
        theme={lightTheme}
        options={bracketOptions}
        onMatchClick={onMatchClick ? ({ match }) => onMatchClick(String(match.id)) : undefined}
        svgWrapper={({ children, bracketWidth, bracketHeight }) => (
          <DoubleScrollSvg bracketWidth={bracketWidth} bracketHeight={bracketHeight}>{children}</DoubleScrollSvg>
        )}
      />
    </div>
  )
}

// ---- Skeleton --------------------------------------------------------------

function Skeleton() {
  return (
    <div className="p-4 mt-2 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-gray-200 animate-pulse" />
      ))}
    </div>
  )
}

// ---- Main page -------------------------------------------------------------

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

  const isLoading =
    matchesQuery.isLoading  ||
    sportsQuery.isLoading   ||
    teamsQuery.isLoading    ||
    companiesQuery.isLoading ||
    bracketsQuery.isLoading

  if (isLoading) return <Skeleton />
  if (sports.length === 0) return <p className="text-center text-gray-500 py-16">No sports found.</p>

  const sportMatches = matchesBySport.get(activeSportId ?? '') ?? []
  const bracketType  = activeSport?.bracket_type

  function renderContent() {
    if (bracketType === 'heats') {
      return <HeatsStandingsView matches={sportMatches} teamMap={teamMap} companyMap={companyMap} />
    }
    if (bracketType === 'single_elimination') {
      return <SingleBracketView matches={sportMatches} teamMap={teamMap} companyMap={companyMap} />
    }
    if (bracketType === 'double_elimination') {
      return (
        <DoubleBracketView
          matches={sportMatches}
          bracketPhaseMap={bracketPhaseMap}
          teamMap={teamMap}
          companyMap={companyMap}
        />
      )
    }
    return <FallbackMatchList matches={sportMatches} teamMap={teamMap} companyMap={companyMap} />
  }

  return (
    <div className="p-4 mt-2">
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
      {renderContent()}
    </div>
  )
}
