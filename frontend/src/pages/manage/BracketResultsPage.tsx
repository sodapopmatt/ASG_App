import React, { useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import ErrorBoundary from '../../components/ErrorBoundary'
import { useTabMemory } from '../../lib/useTabMemory'
import { useQuery } from '@tanstack/react-query'
import {
  DoubleEliminationBracket,
} from '@g-loot/react-tournament-brackets'
import type { MatchType } from '@g-loot/react-tournament-brackets'
import { getMatches } from '../../api/matches'
import { getSports } from '../../api/sports'
import { getTeams } from '../../api/teams'
import { getCompanies } from '../../api/companies'
import { getBrackets } from '../../api/brackets'
import type { Match, Team, Company } from '../../types'
import { toLibraryMatch, stableSortMatches, buildMultiTeamKeys, groupMatchesByCourt, MatchComponent, SingleBracketView, lightTheme, bracketOptions, BracketSvgWrapper } from '../../lib/bracketHelpers'
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

// ── Bracket views ──────────────────────────────────────────────────────────

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
    const multiTeamKeys = buildMultiTeamKeys(teamMap)
    for (const m of stableSortMatches(matches)) {
      const phase = m.bracket_id ? bracketPhaseMap[m.bracket_id] : null
      const lib = toLibraryMatch(m, teamMap, companyMap, ids, multiTeamKeys)
      if (phase === 'losers') lower.push(lib)
      else upper.push(lib)
    }
    return { upper, lower }
  }, [matches, bracketPhaseMap, teamMap, companyMap])

  if (upper.length === 0 && lower.length === 0) return <p className="text-center text-gray-500 py-12">No matches yet.</p>

  // 2-team edge case: no losers bracket exists at all (the sole WB match's
  // loser drops straight into the grand final — see double_elim.py). The
  // @g-loot library crashes internally when `lower` is empty, so render the
  // upper-only structure (WB match + grand final) as a single-elimination
  // bracket instead — that's structurally exactly what it is.
  if (lower.length === 0) {
    return (
      <SingleBracketView matches={matches} teamMap={teamMap} companyMap={companyMap} onMatchClick={onMatchClick} />
    )
  }

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
  const isDone = match.status === 'completed' || match.status === 'forfeit' || match.status === 'double_forfeit' || match.status === 'draw'
  const isLive = match.status === 'in_progress'
  const hasScore = match.home_score != null && match.away_score != null
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white rounded-xl border-2 shadow-sm px-4 py-3 ${isLive ? 'border-amber-400' : 'border-gray-200'} hover:border-blue-400 transition-colors`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className={`text-sm truncate flex-1 ${match.winner_id && match.winner_id === match.home_team_id ? 'font-bold text-green-700' : 'font-semibold text-slate-800'} ${!match.home_team_id ? 'italic text-gray-400 font-normal' : ''}`}>
              {fullLabel(match.home_team_id, teamMap, companyMap)}
            </p>
            {hasScore && <span className="text-sm font-bold text-slate-700 bg-gray-100 rounded-md px-2 py-0.5 tabular-nums shrink-0 min-w-[2rem] text-center">{match.home_score}</span>}
          </div>
          <p className="text-xs text-gray-400 my-0.5">vs</p>
          <div className="flex items-center gap-2">
            <p className={`text-sm truncate flex-1 ${match.winner_id && match.winner_id === match.away_team_id ? 'font-bold text-green-700' : 'font-semibold text-slate-800'} ${!match.away_team_id ? 'italic text-gray-400 font-normal' : ''}`}>
              {fullLabel(match.away_team_id, teamMap, companyMap)}
            </p>
            {hasScore && <span className="text-sm font-bold text-slate-700 bg-gray-100 rounded-md px-2 py-0.5 tabular-nums shrink-0 min-w-[2rem] text-center">{match.away_score}</span>}
          </div>
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

function CourtQueueCard({
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
  const isDone = match.status === 'completed' || match.status === 'forfeit' || match.status === 'double_forfeit' || match.status === 'draw'
  const isLive = match.status === 'in_progress'
  const hasScore = match.home_score != null && match.away_score != null
  const effectiveTime = match.estimated_start ?? match.scheduled_at
  const time = effectiveTime
    ? new Date(effectiveTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white rounded-xl border-2 shadow-sm px-4 py-3 ${isLive ? 'border-amber-400' : 'border-gray-200'} hover:border-blue-400 transition-colors`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {time && <p className="text-xs text-gray-400 mb-1 tabular-nums">{time}</p>}
          <div className="flex items-center gap-2">
            <p className={`text-sm truncate flex-1 ${match.winner_id && match.winner_id === match.home_team_id ? 'font-bold text-green-700' : 'font-semibold text-slate-800'} ${!match.home_team_id ? 'italic text-gray-400 font-normal' : ''}`}>
              {fullLabel(match.home_team_id, teamMap, companyMap)}
            </p>
            {hasScore && <span className="text-sm font-bold text-slate-700 bg-gray-100 rounded-md px-2 py-0.5 tabular-nums shrink-0 min-w-[2rem] text-center">{match.home_score}</span>}
          </div>
          <p className="text-xs text-gray-400 my-0.5">vs</p>
          <div className="flex items-center gap-2">
            <p className={`text-sm truncate flex-1 ${match.winner_id && match.winner_id === match.away_team_id ? 'font-bold text-green-700' : 'font-semibold text-slate-800'} ${!match.away_team_id ? 'italic text-gray-400 font-normal' : ''}`}>
              {fullLabel(match.away_team_id, teamMap, companyMap)}
            </p>
            {hasScore && <span className="text-sm font-bold text-slate-700 bg-gray-100 rounded-md px-2 py-0.5 tabular-nums shrink-0 min-w-[2rem] text-center">{match.away_score}</span>}
          </div>
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

function CourtView({
  matches,
  teamMap,
  companyMap,
  selectedCourt,
  onSelectCourt,
  onMatchClick,
}: {
  matches: Match[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  selectedCourt: string
  onSelectCourt: (court: string) => void
  onMatchClick: (matchId: string) => void
}) {
  const groups = useMemo(() => groupMatchesByCourt(matches), [matches])

  const courtNames = [...groups.keys()]
  if (courtNames.length === 0) return <p className="text-center text-gray-500 py-12">No matches yet.</p>

  const activeCourt = groups.has(selectedCourt) ? selectedCourt : courtNames[0]
  const activeMatches = groups.get(activeCourt) ?? []

  return (
    <div>
      {courtNames.length > 1 && (
        <div className="flex gap-2 mb-4 overflow-x-auto -mx-4 px-4 pb-1">
          {courtNames.map(court => (
            <button
              key={court}
              type="button"
              onClick={() => onSelectCourt(court)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                court === activeCourt
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-slate-600 active:bg-gray-200'
              }`}
            >
              {court}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {activeMatches.map(m => (
          <CourtQueueCard
            key={m.id}
            match={m}
            teamMap={teamMap}
            companyMap={companyMap}
            onClick={() => onMatchClick(m.id)}
          />
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

// â”€â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function BracketResultsPage() {
  const { sportId } = useParams<{ sportId: string }>()
  const [activeMatch, setActiveMatch] = useState<Match | null>(null)
  const [divisionTab, setDivisionTab] = useState<string>('')
  const [viewMode, setViewMode] = useTabMemory<'bracket' | 'court'>(`bracket-results-view-${sportId ?? ''}`, 'bracket')
  const [activeCourt, setActiveCourt] = useTabMemory<string>(`bracket-results-court-${sportId ?? ''}`, '')

  const matchesQuery   = useQuery({
    queryKey: ['matches', { sport_id: sportId }],
    queryFn: () => getMatches({ sport_id: sportId! }),
    enabled: !!sportId,
    refetchInterval: 5000,
  })
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

  const bracketNameMap = useMemo((): Record<string, string> => {
    const map: Record<string, string> = {}
    for (const b of (bracketsQuery.data ?? [])) {
      map[b.id] = b.name
    }
    return map
  }, [bracketsQuery.data])

  const divisionNames = useMemo(
    () => [...new Set((bracketsQuery.data ?? []).map(b => b.division).filter((d): d is string => !!d))],
    [bracketsQuery.data],
  )

  const sportMatches = matchesQuery.data ?? []

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
    // Division mode: segmented tabs matching the public bracket page layout
    const byDivision: Record<string, Match[]> = {}
    const championship: Match[] = []
    for (const m of sportMatches) {
      const div = m.bracket_id ? bracketDivisionMap[m.bracket_id] : undefined
      if (div) (byDivision[div] ??= []).push(m)
      else championship.push(m)
    }
    const sections: { key: string; title: string; content: React.ReactNode }[] = [
      ...divisionNames.map(div => ({
        key: div,
        title: div,
        content: renderElimination(byDivision[div] ?? []),
      })),
      ...(championship.length > 0 ? [{
        key: '__final_game',
        title: bracketNameMap[championship[0].bracket_id ?? ''] ?? 'Championship',
        content: (
          <div className="space-y-2">
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
        ),
      }] : []),
    ]
    const activeKey = sections.find(s => s.key === divisionTab) ? divisionTab : sections[0]?.key ?? ''
    const activeSection = sections.find(s => s.key === activeKey)
    return (
      <div>
        <div className="flex rounded-lg bg-gray-100 p-1 mb-4">
          {sections.map(({ key, title }) => (
            <button
              key={key}
              type="button"
              onClick={() => setDivisionTab(key)}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                key === activeKey ? 'bg-white shadow-sm text-slate-800' : 'text-gray-500'
              }`}
            >
              {title}
            </button>
          ))}
        </div>
        {activeSection?.content}
      </div>
    )
  }

  return (
    <>
      <div className="p-4 mt-2">
        <BackLink to="/manage/results" label="Enter Results" />

        <h2 className="text-xl font-bold text-slate-800 mt-3 mb-1">{sport?.name ?? 'Bracket'}</h2>
        <p className="text-xs text-gray-400 mb-4">Tap a match to enter the result</p>

        <div className="flex rounded-lg bg-gray-100 p-1 mb-4">
          <button
            onClick={() => setViewMode('bracket')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'bracket' ? 'bg-white shadow-sm text-slate-800' : 'text-gray-500'}`}
          >
            Bracket
          </button>
          <button
            onClick={() => setViewMode('court')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'court' ? 'bg-white shadow-sm text-slate-800' : 'text-gray-500'}`}
          >
            By Courts
          </button>
        </div>

        <ErrorBoundary
          key={sportId}
          fallback={() => (
            <p className="text-center text-gray-500 py-16">
              Couldn't display this bracket — its match data may be incomplete.
            </p>
          )}
        >
          {sportMatches.length === 0 ? (
            <p className="text-center text-gray-500 py-12">No matches for this sport yet.</p>
          ) : viewMode === 'court' ? (
            <CourtView
              matches={bracketType === 'pool_bracket' ? bracketPhaseMatches : sportMatches}
              teamMap={teamMap}
              companyMap={companyMap}
              selectedCourt={activeCourt}
              onSelectCourt={setActiveCourt}
              onMatchClick={handleMatchClick}
            />
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
        </ErrorBoundary>
      </div>

      {activeMatch && (
        <MatchResultModal
          match={matchById[activeMatch.id] ?? activeMatch}
          teamMap={teamMap}
          companyMap={companyMap}
          onClose={() => setActiveMatch(null)}
        />
      )}
    </>
  )
}
