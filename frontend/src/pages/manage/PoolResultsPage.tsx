import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getMatches } from '../../api/matches'
import { getSports } from '../../api/sports'
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
        <Link to="/manage/results" className="text-blue-600 text-sm">← Enter Results</Link>

        <h2 className="text-xl font-bold text-slate-800 mt-3 mb-1">{sport?.name ?? 'Pool Play'}</h2>
        <p className="text-xs text-gray-400 mb-4">Tap a match to enter the result</p>

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
          <div className="space-y-8">
            {pools.map(pool => (
              <div key={pool.id}>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">{pool.name}</h3>
                <div className="space-y-3">
                  {byRound(matchesByBracket[pool.id] ?? []).map(([round, roundMatches]) => (
                    <div key={round} className="space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Round {round}</p>
                      {roundMatches.map(m => (
                        <MatchCard
                          key={m.id}
                          match={m}
                          teamMap={teamMap}
                          companyMap={companyMap}
                          onClick={() => setActiveMatch(m)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
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
