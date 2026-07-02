import { useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useTabMemory } from '../../lib/useTabMemory'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getMatches } from '../../api/matches'
import { getSports, getStandings, getChampionshipStandings, generateSwissRound, type TeamStanding, type ChampionshipStandings } from '../../api/sports'
import { getTeams } from '../../api/teams'
import { getCompanies } from '../../api/companies'
import { getBrackets } from '../../api/brackets'
import type { Match, Team, Company, Bracket } from '../../types'
import MatchResultModal from '../../components/MatchResultModal'
import { buildMultiTeamKeys, compactLabel, compareBracketNames, groupMatchesByCourt, SingleBracketView } from '../../lib/bracketHelpers'

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [String(item[key]), item]))
}

function MatchCard({
  match,
  teamMap,
  companyMap,
  multiTeamKeys,
  onClick,
}: {
  match: Match
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  multiTeamKeys: Set<string>
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
            <p className={`text-sm truncate flex-1 ${match.winner_id && match.winner_id === match.home_team_id ? 'font-bold text-green-700' : 'font-semibold text-slate-800'}`}>
              {compactLabel(match.home_team_id, teamMap, companyMap, undefined, multiTeamKeys)}
            </p>
            {hasScore && <span className="text-sm font-semibold text-slate-600 tabular-nums shrink-0">{match.home_score}</span>}
          </div>
          <p className="text-xs text-gray-400 my-0.5">vs</p>
          <div className="flex items-center gap-2">
            <p className={`text-sm truncate flex-1 ${match.winner_id && match.winner_id === match.away_team_id ? 'font-bold text-green-700' : 'font-semibold text-slate-800'}`}>
              {compactLabel(match.away_team_id, teamMap, companyMap, undefined, multiTeamKeys)}
            </p>
            {hasScore && <span className="text-sm font-semibold text-slate-600 tabular-nums shrink-0">{match.away_score}</span>}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {match.locations?.name ? `${match.locations.name} · ` : ''}
            {match.scheduled_at
              ? new Date(match.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
              : 'No time set'}
          </p>
        </div>
        {isLive ? (
          <span className="shrink-0 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full animate-pulse">Live</span>
        ) : isDone ? (
          <span className="shrink-0 text-xs text-gray-400">
            {match.status === 'double_forfeit' ? 'Dbl Forfeit' : match.status === 'forfeit' ? 'Forfeit' : match.status === 'draw' ? 'Draw' : 'Final'}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-blue-400">Tap to enter</span>
        )}
      </div>
    </button>
  )
}

function CourtQueue({
  matches,
  teamMap,
  companyMap,
  multiTeamKeys,
  selectedCourt,
  onSelectCourt,
  onMatchClick,
}: {
  matches: Match[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  multiTeamKeys: Set<string>
  selectedCourt: string
  onSelectCourt: (court: string) => void
  onMatchClick: (match: Match) => void
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
          <MatchCard
            key={m.id}
            match={m}
            teamMap={teamMap}
            companyMap={companyMap}
            multiTeamKeys={multiTeamKeys}
            onClick={() => onMatchClick(m)}
          />
        ))}
      </div>
    </div>
  )
}

const MAX_SWISS_ROUNDS = 6

function StandingsTable({
  standings,
  teamMap,
  companyMap,
  multiTeamKeys,
  showPts = false,
}: {
  standings: TeamStanding[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  multiTeamKeys: Set<string>
  showPts?: boolean
}) {
  if (standings.length === 0) return <p className="text-sm text-gray-400 italic mb-4">No results yet.</p>
  return (
    <div className="mb-4 rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-3 py-2 font-semibold text-gray-500">#</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-500">Team</th>
            {showPts && <th className="text-center px-2 py-2 font-semibold text-gray-500">Pts</th>}
            <th className="text-center px-2 py-2 font-semibold text-gray-500">W</th>
            <th className="text-center px-2 py-2 font-semibold text-gray-500">D</th>
            <th className="text-center px-2 py-2 font-semibold text-gray-500">L</th>
            <th className="text-center px-2 py-2 font-semibold text-gray-500">PD</th>
            <th className="text-center px-2 py-2 font-semibold text-gray-500">TP</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row, i) => {
            const label = compactLabel(row.team_id, teamMap, companyMap, undefined, multiTeamKeys)
            return (
              <tr key={row.team_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                <td className="px-3 py-2 font-bold text-gray-400">{row.rank}</td>
                <td className="px-3 py-2 text-slate-700">{label}</td>
                {showPts && <td className="px-2 py-2 text-center font-bold text-blue-700">{row.tournament_points}</td>}
                <td className="px-2 py-2 text-center font-semibold text-green-700">{row.wins}</td>
                <td className="px-2 py-2 text-center text-slate-600">{row.draws}</td>
                <td className="px-2 py-2 text-center text-gray-500">{row.losses}</td>
                <td className="px-2 py-2 text-center text-slate-600">{row.goal_diff > 0 ? `+${row.goal_diff}` : row.goal_diff}</td>
                <td className="px-2 py-2 text-center text-slate-600">{row.goals_for}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ChampionshipTab({
  bracketPhaseMatches,
  championshipData,
  teamMap,
  companyMap,
  multiTeamKeys,
  byRound,
  onMatchClick,
  onGenerateRound,
  generating,
  error,
}: {
  bracketPhaseMatches: Match[]
  championshipData: ChampionshipStandings | undefined
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
  multiTeamKeys: Set<string>
  byRound: (matches: Match[]) => [string, Match[]][]
  onMatchClick: (m: Match) => void
  onGenerateRound: () => void
  generating: boolean
  error: string | null
}) {
  const currentRound = championshipData?.current_round ?? 0
  const hasMatches = bracketPhaseMatches.length > 0
  const roundMatches = byRound(bracketPhaseMatches)

  const currentRoundMatches = hasMatches
    ? bracketPhaseMatches.filter(m => m.match_round === currentRound)
    : []
  const currentRoundComplete =
    currentRoundMatches.length > 0 &&
    currentRoundMatches.every(
      m => m.status === 'completed' || m.status === 'forfeit' || m.status === 'double_forfeit' || m.status === 'draw',
    )

  const canGenerateNext = !hasMatches || (currentRoundComplete && currentRound < MAX_SWISS_ROUNDS)
  const isDone = currentRoundComplete && currentRound >= MAX_SWISS_ROUNDS

  return (
    <div className="space-y-6">
      {championshipData && championshipData.standings.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Championship Standings</p>
          <StandingsTable
            standings={championshipData.standings}
            teamMap={teamMap}
            companyMap={companyMap}
            multiTeamKeys={multiTeamKeys}
            showPts
          />
          {isDone && (
            <p className="text-xs text-center text-gray-400 mt-1">All {MAX_SWISS_ROUNDS} rounds complete — assign ASG points from the Scoring page.</p>
          )}
        </div>
      )}

      {canGenerateNext && !isDone && (
        <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50/40 p-4 text-center">
          <p className="text-sm font-semibold text-slate-700 mb-1">
            {!hasMatches ? 'Start Swiss Championship' : `Generate Round ${currentRound + 1}`}
          </p>
          <p className="text-xs text-gray-500 mb-3">
            {!hasMatches
              ? 'Takes rank-1 team from each pool and generates Round 1 pairings.'
              : `Pairs teams by current standing, avoiding rematches.`}
          </p>
          {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
          <button
            onClick={onGenerateRound}
            disabled={generating}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {generating ? 'Generating…' : !hasMatches ? 'Generate Round 1' : `Generate Round ${currentRound + 1}`}
          </button>
        </div>
      )}

      {roundMatches.map(([roundKey, matches]) => (
        <div key={roundKey}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Round {roundKey}</p>
          <div className="space-y-2">
            {matches.map(m => (
              <MatchCard
                key={m.id}
                match={m}
                teamMap={teamMap}
                companyMap={companyMap}
                multiTeamKeys={multiTeamKeys}
                onClick={() => onMatchClick(m)}
              />
            ))}
          </div>
        </div>
      ))}

      {!hasMatches && (
        <p className="text-center text-gray-400 text-sm py-4">No championship matches yet.</p>
      )}
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

export default function PoolResultsPage() {
  const { sportId } = useParams<{ sportId: string }>()
  const [activeMatch, setActiveMatch] = useState<Match | null>(null)
  const [swissError, setSwissError] = useState<string | null>(null)
  const qc = useQueryClient()

  const matchesQuery   = useQuery({ queryKey: ['matches'],   queryFn: () => getMatches(), refetchInterval: 5000 })
  const sportsQuery    = useQuery({ queryKey: ['sports'],    queryFn: getSports,        staleTime: Infinity })
  const teamsQuery     = useQuery({ queryKey: ['teams'],     queryFn: () => getTeams(), staleTime: Infinity })
  const companiesQuery = useQuery({ queryKey: ['companies'], queryFn: getCompanies,     staleTime: Infinity })
  const bracketsQuery  = useQuery({
    queryKey: ['brackets', sportId],
    queryFn:  () => getBrackets(sportId!),
    enabled:  !!sportId,
  })
  const standingsQuery = useQuery({
    queryKey: ['standings', sportId],
    queryFn:  () => getStandings(sportId!),
    enabled:  !!sportId,
    refetchInterval: 5000,
  })
  const championshipQuery = useQuery({
    queryKey: ['championship-standings', sportId],
    queryFn:  () => getChampionshipStandings(sportId!),
    enabled:  !!sportId,
    refetchInterval: 5000,
  })

  const swissMutation = useMutation({
    mutationFn: () => generateSwissRound(sportId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] })
      qc.invalidateQueries({ queryKey: ['brackets', sportId] })
      qc.invalidateQueries({ queryKey: ['championship-standings', sportId] })
      setSwissError(null)
    },
    onError: (e: unknown) => setSwissError(e instanceof Error ? e.message : 'Failed to generate round'),
  })

  const teamMap       = useMemo(() => indexBy(teamsQuery.data    ?? [], 'id') as Record<string, Team>,    [teamsQuery.data])
  const companyMap    = useMemo(() => indexBy(companiesQuery.data ?? [], 'id') as Record<string, Company>, [companiesQuery.data])
  const multiTeamKeys = useMemo(() => buildMultiTeamKeys(teamMap), [teamMap])
  const sport      = useMemo(() => (sportsQuery.data ?? []).find(s => s.id === sportId), [sportsQuery.data, sportId])

  const sportMatches = useMemo(
    () => (matchesQuery.data ?? []).filter(m => m.sport_id === sportId),
    [matchesQuery.data, sportId],
  )

  const pools: Bracket[] = useMemo(
    () => (bracketsQuery.data ?? []).filter(b => b.phase === 'pool').sort((a, b) => compareBracketNames(a.name, b.name)),
    [bracketsQuery.data],
  )

  const matchesByBracket = useMemo(() => {
    const map: Record<string, Match[]> = {}
    for (const m of sportMatches) {
      if (m.bracket_id) (map[m.bracket_id] ??= []).push(m)
    }
    return map
  }, [sportMatches])

  const poolBracketIds = useMemo(() => new Set(pools.map(p => p.id)), [pools])

  const bracketPhaseMatches = useMemo(
    () => sportMatches.filter(m => m.bracket_id && !poolBracketIds.has(m.bracket_id)),
    [sportMatches, poolBracketIds],
  )
  const hasBracketPhase = bracketPhaseMatches.length > 0

  const bracketPhaseMatchById = useMemo(
    () => indexBy(bracketPhaseMatches, 'id') as Record<string, Match>,
    [bracketPhaseMatches],
  )
  const handleBracketPhaseMatchClick = (matchId: string) => {
    const match = bracketPhaseMatchById[matchId]
    if (match) setActiveMatch(match)
  }

  const [phase, setPhase] = useTabMemory<'pools' | 'bracket'>(`pool-results-phase-${sportId ?? ''}`, 'pools')
  const [bracketView, setBracketView] = useTabMemory<'bracket' | 'court'>(`pool-results-bracketview-${sportId ?? ''}`, 'bracket')
  const [activeCourt, setActiveCourt] = useTabMemory<string>(`pool-results-court-${sportId ?? ''}`, '')

  const standingsByBracket = useMemo(() => {
    const map: Record<string, TeamStanding[]> = {}
    for (const pool of standingsQuery.data ?? []) {
      map[pool.bracket_id] = pool.standings
    }
    return map
  }, [standingsQuery.data])

  const showGameScores    = sport?.name?.toLowerCase() === 'pickleball'
  const showSoccerStats   = sport?.name?.toLowerCase() === 'soccer'
  const showCornhole      = sport?.bracket_type === 'pool_swiss'
  const showDraw          = sport?.name?.toLowerCase() === 'soccer' || showCornhole

  const [activePoolId, setActivePoolId] = useTabMemory<string>(
    `pool-results-tabs-${sportId ?? ''}`,
    pools[0]?.id ?? '',
  )
  const selectedPoolId = pools.some(p => p.id === activePoolId) ? activePoolId : pools[0]?.id ?? ''
  const visiblePools = pools.filter(p => p.id === selectedPoolId)

  const isLoading =
    matchesQuery.isLoading  ||
    sportsQuery.isLoading   ||
    teamsQuery.isLoading    ||
    companiesQuery.isLoading ||
    bracketsQuery.isLoading

  if (isLoading) return <Skeleton />

  function byRound(matches: Match[]): [string, Match[]][] {
    const groups: Record<string, Match[]> = {}
    for (const m of matches) {
      const key = m.match_round != null ? String(m.match_round) : '?'
      ;(groups[key] ??= []).push(m)
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => {
        const aTime = a.scheduled_at ?? ''
        const bTime = b.scheduled_at ?? ''
        if (aTime !== bTime) return aTime < bTime ? -1 : 1
        return a.id < b.id ? -1 : 1
      })
    }
    return Object.entries(groups).sort(([a], [b]) => Number(a) - Number(b))
  }

  return (
    <>
      <div className="p-4 mt-2">
        <BackLink to="/manage/results" label="Enter Results" />

        <h2 className="text-xl font-bold text-slate-800 mt-3 mb-4">{sport?.name ?? 'Pool Play'}</h2>

        <div className="flex rounded-lg bg-gray-100 p-1 mb-4">
          <button
            onClick={() => setPhase('pools')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${phase === 'pools' ? 'bg-white shadow-sm text-slate-800' : 'text-gray-500'}`}
          >
            Pool Play
          </button>
          <button
            onClick={() => setPhase('bracket')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${phase === 'bracket' ? 'bg-white shadow-sm text-slate-800' : 'text-gray-500'}`}
          >
            {showCornhole ? 'Championship' : 'Bracket Phase'}
          </button>
        </div>

        {phase === 'bracket' && bracketPhaseMatches.length > 0 && (
          <div className="flex rounded-lg bg-gray-100 p-1 mb-4">
            <button
              onClick={() => setBracketView('bracket')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${bracketView === 'bracket' ? 'bg-white shadow-sm text-slate-800' : 'text-gray-500'}`}
            >
              Bracket
            </button>
            <button
              onClick={() => setBracketView('court')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${bracketView === 'court' ? 'bg-white shadow-sm text-slate-800' : 'text-gray-500'}`}
            >
              By Courts
            </button>
          </div>
        )}

        {phase === 'pools' ? (
          pools.length === 0 ? (
            <p className="text-center text-gray-500 py-12">No pools for this sport yet.</p>
          ) : (
            <>
              {pools.length > 1 && (
                <div className="flex gap-2 mb-4 overflow-x-auto -mx-4 px-4 pb-1">
                  {pools.map(pool => (
                    <button
                      key={pool.id}
                      type="button"
                      onClick={() => setActivePoolId(pool.id)}
                      className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                        pool.id === selectedPoolId
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-slate-600 active:bg-gray-200'
                      }`}
                    >
                      {pool.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="space-y-8">
                {visiblePools.map(pool => {
                  const poolStandings = standingsByBracket[pool.id] ?? []
                  return (
                    <div key={pool.id}>
                      <h3 className="text-base font-bold text-slate-800 mb-3">{pool.name}</h3>

                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Standings</p>
                      {poolStandings.length > 0 ? (
                        <div className="mb-4 rounded-xl border border-gray-200 overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50 border-b border-gray-200">
                              <tr>
                                <th className="text-left px-3 py-2 font-semibold text-gray-500">#</th>
                                <th className="text-left px-3 py-2 font-semibold text-gray-500">Team</th>
                                {showCornhole && <th className="text-center px-2 py-2 font-semibold text-gray-500">Pts</th>}
                                <th className="text-center px-2 py-2 font-semibold text-gray-500">W</th>
                                {(showSoccerStats || showCornhole) && <th className="text-center px-2 py-2 font-semibold text-gray-500">D</th>}
                                <th className="text-center px-2 py-2 font-semibold text-gray-500">L</th>
                                {showSoccerStats && (
                                  <>
                                    <th className="text-center px-2 py-2 font-semibold text-gray-500">GF</th>
                                    <th className="text-center px-2 py-2 font-semibold text-gray-500">GA</th>
                                    <th className="text-center px-2 py-2 font-semibold text-gray-500">GD</th>
                                  </>
                                )}
                                {showCornhole && (
                                  <>
                                    <th className="text-center px-2 py-2 font-semibold text-gray-500">PD</th>
                                    <th className="text-center px-2 py-2 font-semibold text-gray-500">TP</th>
                                  </>
                                )}
                                {showGameScores && (
                                  <>
                                    <th className="text-center px-2 py-2 font-semibold text-gray-500">GW</th>
                                    <th className="text-center px-2 py-2 font-semibold text-gray-500">PD</th>
                                    <th className="text-center px-2 py-2 font-semibold text-gray-500">TP</th>
                                  </>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {poolStandings.map((row, i) => {
                                const label = compactLabel(row.team_id, teamMap, companyMap, undefined, multiTeamKeys)
                                return (
                                  <tr key={row.team_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                                    <td className="px-3 py-2 font-bold text-gray-400">{row.rank}</td>
                                    <td className="px-3 py-2 text-slate-700">{label}</td>
                                    {showCornhole && <td className="px-2 py-2 text-center font-bold text-blue-700">{row.tournament_points}</td>}
                                    <td className="px-2 py-2 text-center font-semibold text-green-700">{row.wins}</td>
                                    {(showSoccerStats || showCornhole) && <td className="px-2 py-2 text-center text-slate-600">{row.draws}</td>}
                                    <td className="px-2 py-2 text-center text-gray-500">{row.losses}</td>
                                    {showSoccerStats && (
                                      <>
                                        <td className="px-2 py-2 text-center text-slate-600">{row.goals_for}</td>
                                        <td className="px-2 py-2 text-center text-slate-600">{row.goals_against}</td>
                                        <td className="px-2 py-2 text-center text-slate-600">{row.goal_diff > 0 ? `+${row.goal_diff}` : row.goal_diff}</td>
                                      </>
                                    )}
                                    {showCornhole && (
                                      <>
                                        <td className="px-2 py-2 text-center text-slate-600">{row.goal_diff > 0 ? `+${row.goal_diff}` : row.goal_diff}</td>
                                        <td className="px-2 py-2 text-center text-slate-600">{row.goals_for}</td>
                                      </>
                                    )}
                                    {showGameScores && (
                                      <>
                                        <td className="px-2 py-2 text-center text-slate-600">{row.game_wins}</td>
                                        <td className="px-2 py-2 text-center text-slate-600">{row.point_diff > 0 ? `+${row.point_diff}` : row.point_diff}</td>
                                        <td className="px-2 py-2 text-center text-slate-600">{row.total_points}</td>
                                      </>
                                    )}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 italic mb-4">No results yet.</p>
                      )}

                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Matches</p>
                      <div className="space-y-2">
                        {byRound(matchesByBracket[pool.id] ?? []).map(([, roundMatches]) => (
                          roundMatches.map(m => (
                            <MatchCard
                              key={m.id}
                              match={m}
                              teamMap={teamMap}
                              companyMap={companyMap}
                              multiTeamKeys={multiTeamKeys}
                              onClick={() => setActiveMatch(m)}
                            />
                          ))
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )
        ) : bracketView === 'court' ? (
          <CourtQueue
            matches={bracketPhaseMatches}
            teamMap={teamMap}
            companyMap={companyMap}
            multiTeamKeys={multiTeamKeys}
            selectedCourt={activeCourt}
            onSelectCourt={setActiveCourt}
            onMatchClick={setActiveMatch}
          />
        ) : showCornhole ? (
          <ChampionshipTab
            bracketPhaseMatches={bracketPhaseMatches}
            championshipData={championshipQuery.data}
            teamMap={teamMap}
            companyMap={companyMap}
            multiTeamKeys={multiTeamKeys}
            byRound={byRound}
            onMatchClick={setActiveMatch}
            onGenerateRound={() => swissMutation.mutate()}
            generating={swissMutation.isPending}
            error={swissError}
          />
        ) : hasBracketPhase ? (
          <SingleBracketView
            matches={bracketPhaseMatches}
            teamMap={teamMap}
            companyMap={companyMap}
            onMatchClick={handleBracketPhaseMatchClick}
          />
        ) : (
          <p className="text-center text-gray-500 py-12">Bracket phase not generated yet.</p>
        )}
      </div>

      {activeMatch && (
        <MatchResultModal
          match={activeMatch}
          teamMap={teamMap}
          companyMap={companyMap}
          onClose={() => setActiveMatch(null)}
          showGameScores={showGameScores}
          showDraw={showDraw}
        />
      )}
    </>
  )
}
