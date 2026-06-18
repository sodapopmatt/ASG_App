import React, { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  SingleEliminationBracket,
  DoubleEliminationBracket,
  Match as LibMatch,
} from '@g-loot/react-tournament-brackets'
import type { MatchType, MatchComponentProps } from '@g-loot/react-tournament-brackets'
import { getMatches } from '../../api/matches'
import { getSports } from '../../api/sports'
import { getTeams } from '../../api/teams'
import { getCompanies } from '../../api/companies'
import { getBrackets } from '../../api/brackets'
import type { Match, Team, Company } from '../../types'
import { toLibraryMatch, stableSortMatches, lightTheme, bracketOptions, BracketSvgWrapper } from '../../lib/bracketHelpers'
import MatchResultModal from '../../components/MatchResultModal'

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [String(item[key]), item]))
}

function fullLabel(
  teamId: string | null,
  teamMap: Record<string, Team>,
  companyMap: Record<string, Company>,
): string {
  if (!teamId) return 'TBD'
  const team = teamMap[teamId]
  if (!team) return 'Unknown'
  const company = companyMap[team.company_id]
  const base = company?.name ?? 'Unknown'
  return team.name ? `${base} · ${team.name}` : base
}

// ─── Custom match component ───────────────────────────────────────────────────

function MatchComponent(props: MatchComponentProps) {
  const isPlaying = props.match.state === 'PLAYING'
  const openModal = () => props.onMatchClick({ match: props.match, topWon: props.topWon, bottomWon: props.bottomWon, event: {} as React.MouseEvent<HTMLAnchorElement> })
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <LibMatch {...props} onMatchClick={undefined} onPartyClick={openModal} />
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

// ─── Bracket views ────────────────────────────────────────────────────────────

function SingleBracketView({
  matches,
  teamMap,
  companyMap,
  onMatchClick,
}: {
  matches: Match[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  onMatchClick: (matchId: string) => void
}) {
  const libMatches = useMemo(() => {
    const ids = new Set(matches.map(m => m.id))
    return stableSortMatches(matches).map(m => toLibraryMatch(m, teamMap, companyMap, ids))
  }, [matches, teamMap, companyMap])

  if (libMatches.length === 0) return <p className="text-center text-gray-500 py-12">No matches yet.</p>

  return (
    <SingleEliminationBracket
      matches={libMatches}
      matchComponent={MatchComponent}
      theme={lightTheme}
      options={bracketOptions}
      onMatchClick={({ match }) => onMatchClick(String(match.id))}
      svgWrapper={BracketSvgWrapper}
    />
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
  onMatchClick: (matchId: string) => void
}) {
  const { upper, lower } = useMemo(() => {
    const upper: MatchType[] = []
    const lower: MatchType[] = []
    const ids = new Set(matches.map(m => m.id))
    for (const m of stableSortMatches(matches)) {
      const phase = m.bracket_id ? bracketPhaseMap[m.bracket_id] : null
      const lib = toLibraryMatch(m, teamMap, companyMap, ids)
      if (phase === 'losers') lower.push(lib)
      else upper.push(lib)
    }
    return { upper, lower }
  }, [matches, bracketPhaseMap, teamMap, companyMap])

  if (upper.length === 0 && lower.length === 0) return <p className="text-center text-gray-500 py-12">No matches yet.</p>

  return (
    <DoubleEliminationBracket
      matches={{ upper, lower }}
      matchComponent={MatchComponent}
      theme={lightTheme}
      options={bracketOptions}
      onMatchClick={({ match }) => onMatchClick(String(match.id))}
      svgWrapper={BracketSvgWrapper}
    />
  )
}

function ChampionshipCard({
  match,
  teamMap,
  companyMap,
  onClick,
}: {
  match: Match
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  onClick: () => void
}) {
  const isDone = match.status === 'completed' || match.status === 'forfeit' || match.status === 'double_forfeit'
  const isLive = match.status === 'in_progress'
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white rounded-xl border-2 shadow-sm px-4 py-3 ${isLive ? 'border-amber-400' : 'border-gray-200'} hover:border-blue-400 transition-colors`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-sm truncate ${match.winner_id && match.winner_id === match.home_team_id ? 'font-bold text-green-700' : 'font-semibold text-slate-800'} ${!match.home_team_id ? 'italic text-gray-400 font-normal' : ''}`}>
            {fullLabel(match.home_team_id, teamMap, companyMap)}
          </p>
          <p className="text-xs text-gray-400 my-0.5">vs</p>
          <p className={`text-sm truncate ${match.winner_id && match.winner_id === match.away_team_id ? 'font-bold text-green-700' : 'font-semibold text-slate-800'} ${!match.away_team_id ? 'italic text-gray-400 font-normal' : ''}`}>
            {fullLabel(match.away_team_id, teamMap, companyMap)}
          </p>
        </div>
        {isLive ? (
          <span className="shrink-0 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full animate-pulse">Live</span>
        ) : isDone ? (
          <span className="shrink-0 text-xs text-gray-400">
            {match.status === 'double_forfeit' ? 'Dbl Forfeit' : match.status === 'forfeit' ? 'Forfeit' : 'Final'}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-blue-400">Tap to enter</span>
        )}
      </div>
    </button>
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BracketResultsPage() {
  const { sportId } = useParams<{ sportId: string }>()
  const [activeMatch, setActiveMatch] = useState<Match | null>(null)

  const matchesQuery   = useQuery({ queryKey: ['matches'],           queryFn: () => getMatches() })
  const sportsQuery    = useQuery({ queryKey: ['sports'],            queryFn: getSports,        staleTime: Infinity })
  const teamsQuery     = useQuery({ queryKey: ['teams'],             queryFn: () => getTeams(), staleTime: Infinity })
  const companiesQuery = useQuery({ queryKey: ['companies'],         queryFn: getCompanies,     staleTime: Infinity })
  const bracketsQuery  = useQuery({
    queryKey: ['brackets', sportId],
    queryFn:  () => getBrackets(sportId!),
    enabled:  !!sportId,
    staleTime: Infinity,
  })

  const teamMap    = useMemo(() => indexBy(teamsQuery.data    ?? [], 'id') as Record<string, Team>,    [teamsQuery.data])
  const companyMap = useMemo(() => indexBy(companiesQuery.data ?? [], 'id') as Record<string, Company>, [companiesQuery.data])
  const sport      = useMemo(() => (sportsQuery.data ?? []).find(s => s.id === sportId), [sportsQuery.data, sportId])

  const bracketPhaseMap = useMemo((): Record<string, string> => {
    const map: Record<string, string> = {}
    for (const b of (bracketsQuery.data ?? [])) {
      if (b.phase) map[b.id] = b.phase
    }
    return map
  }, [bracketsQuery.data])

  const bracketDivisionMap = useMemo((): Record<string, string> => {
    const map: Record<string, string> = {}
    for (const b of (bracketsQuery.data ?? [])) {
      if (b.division) map[b.id] = b.division
    }
    return map
  }, [bracketsQuery.data])

  const divisionNames = useMemo(
    () => [...new Set((bracketsQuery.data ?? []).map(b => b.division).filter((d): d is string => !!d))],
    [bracketsQuery.data],
  )

  const sportMatches = useMemo(
    () => (matchesQuery.data ?? []).filter(m => m.sport_id === sportId),
    [matchesQuery.data, sportId],
  )

  // pool_bracket sports: the bracket view shows only the elimination phase
  const bracketPhaseMatches = useMemo(
    () => sportMatches.filter(m => !m.bracket_id || bracketPhaseMap[m.bracket_id] !== 'pool'),
    [sportMatches, bracketPhaseMap],
  )

  // Build a fast lookup so onMatchClick can find the full Match by id
  const matchById = useMemo(() => indexBy(sportMatches, 'id') as Record<string, Match>, [sportMatches])

  const handleMatchClick = (matchId: string) => {
    const match = matchById[matchId]
    if (match) setActiveMatch(match)
  }

  const isLoading =
    matchesQuery.isLoading  ||
    sportsQuery.isLoading   ||
    teamsQuery.isLoading    ||
    companiesQuery.isLoading ||
    bracketsQuery.isLoading

  if (isLoading) return <Skeleton />

  const bracketType = sport?.bracket_type

  function renderElimination(matches: Match[]) {
    if (bracketType === 'single_elimination') {
      return (
        <SingleBracketView
          matches={matches}
          teamMap={teamMap}
          companyMap={companyMap}
          onMatchClick={handleMatchClick}
        />
      )
    }
    return (
      <DoubleBracketView
        matches={matches}
        bracketPhaseMap={bracketPhaseMap}
        teamMap={teamMap}
        companyMap={companyMap}
        onMatchClick={handleMatchClick}
      />
    )
  }

  function renderBrackets() {
    if (divisionNames.length === 0) {
      return renderElimination(sportMatches)
    }
    // Division mode: one bracket per division plus a cross-division championship
    const byDivision: Record<string, Match[]> = {}
    const championship: Match[] = []
    for (const m of sportMatches) {
      const div = m.bracket_id ? bracketDivisionMap[m.bracket_id] : undefined
      if (div) (byDivision[div] ??= []).push(m)
      else championship.push(m)
    }
    return (
      <div className="space-y-8">
        {championship.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Championship</h3>
            {championship.map(m => (
              <ChampionshipCard
                key={m.id}
                match={m}
                teamMap={teamMap}
                companyMap={companyMap}
                onClick={() => setActiveMatch(m)}
              />
            ))}
          </div>
        )}
        {divisionNames.map(div => (
          <div key={div}>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">{div}</h3>
            {renderElimination(byDivision[div] ?? [])}
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="p-4 mt-2">
        <Link to="/manage/results" className="text-blue-600 text-sm">← Enter Results</Link>

        <h2 className="text-xl font-bold text-slate-800 mt-3 mb-1">{sport?.name ?? 'Bracket'}</h2>
        <p className="text-xs text-gray-400 mb-4">Tap a match to enter the result</p>

        {sportMatches.length === 0 ? (
          <p className="text-center text-gray-500 py-12">No matches for this sport yet.</p>
        ) : bracketType === 'single_elimination' || bracketType === 'double_elimination' ? (
          renderBrackets()
        ) : bracketType === 'pool_bracket' ? (
          bracketPhaseMatches.length === 0 ? (
            <p className="text-center text-gray-500 py-12">Bracket phase not generated yet.</p>
          ) : (
            <SingleBracketView
              matches={bracketPhaseMatches}
              teamMap={teamMap}
              companyMap={companyMap}
              onMatchClick={handleMatchClick}
            />
          )
        ) : (
          <p className="text-center text-gray-500 py-12">Bracket type not supported here.</p>
        )}
      </div>

      {activeMatch && (
        <MatchResultModal
          match={activeMatch}
          teamMap={teamMap}
          companyMap={companyMap}
          onClose={() => setActiveMatch(null)}
        />
      )}
    </>
  )
}
