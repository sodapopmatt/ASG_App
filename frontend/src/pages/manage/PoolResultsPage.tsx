import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useTabMemory } from '../../lib/useTabMemory'
import { useQuery } from '@tanstack/react-query'
import { getMatches } from '../../api/matches'
import { getSports, getStandings, type TeamStanding } from '../../api/sports'
import { getTeams } from '../../api/teams'
import { getCompanies } from '../../api/companies'
import { getBrackets } from '../../api/brackets'
import type { Match, Team, Company, Bracket } from '../../types'
import MatchResultModal from '../../components/MatchResultModal'

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [String(item[key]), item]))
}

function teamLabel(
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

function MatchCard({
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
  const hasScore = match.status === 'completed' && match.home_score != null && match.away_score != null
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white rounded-xl border-2 shadow-sm px-4 py-3 ${isLive ? 'border-amber-400' : 'border-gray-200'} hover:border-blue-400 transition-colors`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className={`text-sm truncate flex-1 ${match.winner_id && match.winner_id === match.home_team_id ? 'font-bold text-green-700' : 'font-semibold text-slate-800'}`}>
              {teamLabel(match.home_team_id, teamMap, companyMap)}
            </p>
            {hasScore && <span className="text-sm font-semibold text-slate-600 tabular-nums shrink-0">{match.home_score}</span>}
          </div>
          <p className="text-xs text-gray-400 my-0.5">vs</p>
          <div className="flex items-center gap-2">
            <p className={`text-sm truncate flex-1 ${match.winner_id && match.winner_id === match.away_team_id ? 'font-bold text-green-700' : 'font-semibold text-slate-800'}`}>
              {teamLabel(match.away_team_id, teamMap, companyMap)}
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

export default function PoolResultsPage() {
  const { sportId } = useParams<{ sportId: string }>()
  const [activeMatch, setActiveMatch] = useState<Match | null>(null)

  const matchesQuery   = useQuery({ queryKey: ['matches'],   queryFn: () => getMatches() })
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
  })

  const teamMap    = useMemo(() => indexBy(teamsQuery.data    ?? [], 'id') as Record<string, Team>,    [teamsQuery.data])
  const companyMap = useMemo(() => indexBy(companiesQuery.data ?? [], 'id') as Record<string, Company>, [companiesQuery.data])
  const sport      = useMemo(() => (sportsQuery.data ?? []).find(s => s.id === sportId), [sportsQuery.data, sportId])

  const sportMatches = useMemo(
    () => (matchesQuery.data ?? []).filter(m => m.sport_id === sportId),
    [matchesQuery.data, sportId],
  )

  const pools: Bracket[] = useMemo(
    () => (bracketsQuery.data ?? []).filter(b => b.phase === 'pool'),
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
  const hasBracketPhase = useMemo(
    () => sportMatches.some(m => m.bracket_id && !poolBracketIds.has(m.bracket_id)),
    [sportMatches, poolBracketIds],
  )

  const standingsByBracket = useMemo(() => {
    const map: Record<string, TeamStanding[]> = {}
    for (const pool of standingsQuery.data ?? []) {
      map[pool.bracket_id] = pool.standings
    }
    return map
  }, [standingsQuery.data])

  const showGameScores = sport?.name === 'Pickleball'

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
    return Object.entries(groups).sort(([a], [b]) => Number(a) - Number(b))
  }

  return (
    <>
      <div className="p-4 mt-2">
        <BackLink to="/manage/results" label="Enter Results" />

        <h2 className="text-xl font-bold text-slate-800 mt-3 mb-4">{sport?.name ?? 'Pool Play'}</h2>

        {hasBracketPhase && (
          <Link
            to={`/manage/results/brackets/${sportId}`}
            className="flex items-center justify-between w-full px-4 py-3 mb-5 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 active:bg-blue-800 transition-colors"
          >
            View Bracket Phase
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        )}

        {pools.length === 0 ? (
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

                  {/* Standings */}
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Standings</p>
                  {poolStandings.length > 0 ? (
                    <div className="mb-4 rounded-xl border border-gray-200 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="text-left px-3 py-2 font-semibold text-gray-500">#</th>
                            <th className="text-left px-3 py-2 font-semibold text-gray-500">Team</th>
                            <th className="text-center px-2 py-2 font-semibold text-gray-500">W</th>
                            <th className="text-center px-2 py-2 font-semibold text-gray-500">L</th>
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
                            const team = teamMap[row.team_id]
                            const company = team ? companyMap[team.company_id] : null
                            const label = team?.name ? `${company?.name ?? '—'} · ${team.name}` : company?.name ?? '—'
                            return (
                              <tr key={row.team_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                                <td className="px-3 py-2 font-bold text-gray-400">{row.rank}</td>
                                <td className="px-3 py-2 text-slate-700">{label}</td>
                                <td className="px-2 py-2 text-center font-semibold text-green-700">{row.wins}</td>
                                <td className="px-2 py-2 text-center text-gray-500">{row.losses}</td>
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

                  {/* Matches */}
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Matches</p>
                  <div className="space-y-2">
                    {byRound(matchesByBracket[pool.id] ?? []).map(([, roundMatches]) => (
                      roundMatches.map(m => (
                        <MatchCard
                          key={m.id}
                          match={m}
                          teamMap={teamMap}
                          companyMap={companyMap}
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
        )}
      </div>

      {activeMatch && (
        <MatchResultModal
          match={activeMatch}
          teamMap={teamMap}
          companyMap={companyMap}
          onClose={() => setActiveMatch(null)}
          showGameScores={showGameScores}
        />
      )}
    </>
  )
}
