import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMatches } from '../api/matches'
import { getSports } from '../api/sports'
import { getTeams } from '../api/teams'
import { getCompanies } from '../api/companies'
import type { Match, Sport, Team, Company } from '../types'

type Tab = 'upcoming' | 'completed'

function useScheduleData() {
  const matches   = useQuery({ queryKey: ['matches'],    queryFn: () => getMatches() })
  const sports    = useQuery({ queryKey: ['sports'],     queryFn: getSports,          staleTime: Infinity })
  const teams     = useQuery({ queryKey: ['teams'],      queryFn: () => getTeams(),   staleTime: Infinity })
  const companies = useQuery({ queryKey: ['companies'],  queryFn: getCompanies,       staleTime: Infinity })

  const sportMap   = useMemo(() => indexBy(sports.data   ?? [], 'id') as Record<string, Sport>,   [sports.data])
  const teamMap    = useMemo(() => indexBy(teams.data    ?? [], 'id') as Record<string, Team>,    [teams.data])
  const companyMap = useMemo(() => indexBy(companies.data ?? [], 'id') as Record<string, Company>, [companies.data])

  return {
    matches: matches.data ?? [],
    sportMap,
    teamMap,
    companyMap,
    isLoading: matches.isLoading || sports.isLoading || teams.isLoading || companies.isLoading,
    isError: matches.isError,
  }
}

function indexBy<T>(arr: T[], key: keyof T): Record<string, T> {
  return Object.fromEntries(arr.map(item => [item[key], item]))
}

function teamLabel(teamId: string | null, teamMap: Record<string, Team>, companyMap: Record<string, Company>) {
  if (!teamId) return 'TBD'
  const team = teamMap[teamId]
  if (!team) return '—'
  const company = companyMap[team.company_id]
  const base = company?.name ?? 'Unknown'
  return team.name ? `${base} (${team.name})` : base
}

function StatusPill({ status }: { status: Match['status'] }) {
  if (status === 'in_progress') {
    return (
      <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full animate-pulse">
        Live
      </span>
    )
  }
  return null
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
  const homeLabel   = teamLabel(match.home_team_id, teamMap, companyMap)
  const awayLabel   = teamLabel(match.away_team_id, teamMap, companyMap)
  const isWinnerHome = match.winner_id && match.winner_id === teamMap[match.home_team_id ?? '']?.id
  const isWinnerAway = match.winner_id && match.winner_id === teamMap[match.away_team_id ?? '']?.id

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <StatusPill status={match.status} />
        {match.status !== 'in_progress' && <span />}
      </div>

      <div className="flex items-center gap-2">
        <span className={`flex-1 text-sm font-semibold truncate ${isWinnerHome ? 'text-green-700' : 'text-slate-800'}`}>
          {homeLabel}
        </span>

        {(match.status === 'completed' || match.status === 'forfeit' || match.status === 'double_forfeit') ? (
          <span className="shrink-0 text-xs font-medium text-gray-400 w-14 text-center">
            {match.status === 'double_forfeit' ? 'Dbl Forfeit' : match.status === 'forfeit' ? 'Forfeit' : 'Final'}
          </span>
        ) : (
          <span className="shrink-0 text-sm text-gray-400 w-14 text-center">vs</span>
        )}

        <span className={`flex-1 text-sm font-semibold text-right truncate ${isWinnerAway ? 'text-green-700' : 'text-slate-800'}`}>
          {awayLabel}
        </span>
      </div>

      {(match.status === 'completed' || match.status === 'forfeit') && match.winner_id && (
        <p className="text-xs text-green-700 font-medium mt-1">
          Winner: {teamLabel(match.winner_id, teamMap, companyMap)}
        </p>
      )}

      {match.scheduled_at && match.status === 'scheduled' && (
        <p className="text-xs text-gray-400 mt-2">
          {new Date(match.scheduled_at).toLocaleString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
          })}
        </p>
      )}

      {match.locations?.name && (
        <p className="text-xs text-gray-400 mt-1">{match.locations.name}</p>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-3 p-4 mt-16">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-20 rounded-xl bg-gray-200 animate-pulse" />
      ))}
    </div>
  )
}

function groupBySportAndRound(matches: Match[], sportMap: Record<string, Sport>) {
  const sportOrder: string[] = []
  const bySport: Record<string, { sport: Sport; rounds: Record<string, Match[]> }> = {}

  for (const match of matches) {
    const sport = sportMap[match.sport_id]
    if (!sport) continue

    if (!bySport[match.sport_id]) {
      bySport[match.sport_id] = { sport, rounds: {} }
      sportOrder.push(match.sport_id)
    }

    const roundKey = match.match_round != null ? String(match.match_round) : 'unscheduled'
    if (!bySport[match.sport_id].rounds[roundKey]) {
      bySport[match.sport_id].rounds[roundKey] = []
    }
    bySport[match.sport_id].rounds[roundKey].push(match)
  }

  return sportOrder.map(sportId => ({
    sportId,
    sport: bySport[sportId].sport,
    rounds: Object.entries(bySport[sportId].rounds)
      .sort(([a], [b]) => {
        if (a === 'unscheduled') return 1
        if (b === 'unscheduled') return -1
        return Number(a) - Number(b)
      })
      .map(([roundKey, matches]) => ({ roundKey, matches })),
  }))
}

export default function Schedule() {
  const [tab, setTab] = useState<Tab>('upcoming')
  const { matches, sportMap, teamMap, companyMap, isLoading, isError } = useScheduleData()

  const [expandedSports, setExpandedSports] = useState<Set<string>>(new Set())
  const [expandedRounds, setExpandedRounds] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    const isUpcoming = (m: Match) => m.status === 'scheduled' || m.status === 'in_progress'
    if (tab === 'upcoming') {
      return matches
        .filter(isUpcoming)
        .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
    }
    return matches
      .filter(m => m.status === 'completed' || m.status === 'forfeit' || m.status === 'double_forfeit')
      .sort((a, b) => (b.played_at ?? b.created_at).localeCompare(a.played_at ?? a.created_at))
  }, [matches, tab])

  const grouped = useMemo(() => groupBySportAndRound(filtered, sportMap), [filtered, sportMap])

  function toggleSport(sportId: string) {
    setExpandedSports(prev => {
      const next = new Set(prev)
      next.has(sportId) ? next.delete(sportId) : next.add(sportId)
      return next
    })
  }

  function toggleRound(key: string) {
    setExpandedRounds(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  if (isLoading) return <Skeleton />
  if (isError) return <p className="text-center text-red-500 p-8">Failed to load schedule.</p>

  return (
    <div className="p-4">
      <div className="flex rounded-lg bg-gray-100 p-1 mb-4 mt-2">
        {(['upcoming', 'completed'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors capitalize ${
              tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-gray-500'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {grouped.length === 0 && (
        <p className="text-center text-gray-500 py-12">No {tab} matches.</p>
      )}

      <div className="space-y-2">
        {grouped.map(({ sportId, sport, rounds }) => {
          const sportExpanded = expandedSports.has(sportId)
          const totalMatches = rounds.reduce((n, r) => n + r.matches.length, 0)

          return (
            <div key={sportId} className="rounded-xl border border-gray-200 overflow-hidden">
              {/* Sport header */}
              <button
                onClick={() => toggleSport(sportId)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-gray-500 transition-transform" style={{ transform: sportExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
                  <span className="font-semibold text-slate-800">{sport.name}</span>
                </div>
                <span className="text-xs text-gray-400">{totalMatches} match{totalMatches !== 1 ? 'es' : ''}</span>
              </button>

              {/* Rounds */}
              {sportExpanded && (
                <div className="divide-y divide-gray-100">
                  {rounds.map(({ roundKey, matches: roundMatches }) => {
                    const roundExpandKey = `${sportId}-${roundKey}`
                    const roundExpanded = expandedRounds.has(roundExpandKey)
                    const roundLabel = roundKey === 'unscheduled' ? 'Unscheduled' : `Round ${roundKey}`

                    return (
                      <div key={roundKey}>
                        {/* Round header */}
                        <button
                          onClick={() => toggleRound(roundExpandKey)}
                          className="w-full flex items-center justify-between px-6 py-2.5 bg-white hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <svg className="w-3.5 h-3.5 text-gray-400 transition-transform" style={{ transform: roundExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
                            <span className="text-sm font-medium text-slate-700">{roundLabel}</span>
                          </div>
                          <span className="text-xs text-gray-400">{roundMatches.length} match{roundMatches.length !== 1 ? 'es' : ''}</span>
                        </button>

                        {/* Match cards */}
                        {roundExpanded && (
                          <div className="px-4 pb-3 pt-1 space-y-2 bg-gray-50">
                            {roundMatches.map(match => (
                              <MatchCard
                                key={match.id}
                                match={match}
                                teamMap={teamMap}
                                companyMap={companyMap}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
