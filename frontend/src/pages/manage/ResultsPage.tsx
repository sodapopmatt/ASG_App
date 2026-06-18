import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getMatches } from '../../api/matches'
import { getTeams } from '../../api/teams'
import { getSports } from '../../api/sports'
import { getCompanies } from '../../api/companies'
import { getSportIcon } from '../../lib/sportIcons'
import type { Match, Team, Sport, Company } from '../../types'

const BRACKET_TYPES = new Set(['single_elimination', 'double_elimination'])
const HEATS_TYPES = new Set(['heats'])
const POOL_TYPES = new Set(['pool_bracket', 'pool_swiss'])

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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function SportRow({
  sport,
  matches,
  teamMap,
  companyMap,
}: {
  sport: Sport
  matches: Match[]
  teamMap: Record<string, Team>
  companyMap: Record<string, Company>
}) {
  const [open, setOpen] = useState(false)
  const isBracket = BRACKET_TYPES.has(sport.bracket_type)
  const isHeats = HEATS_TYPES.has(sport.bracket_type)
  const isPool = POOL_TYPES.has(sport.bracket_type)
  const pendingCount = matches.filter(
    m => m.status === 'scheduled' || m.status === 'in_progress',
  ).length

  const destination = isBracket
    ? `/manage/results/brackets/${sport.id}`
    : isHeats
    ? `/manage/results/heats/${sport.id}`
    : isPool
    ? `/manage/results/pools/${sport.id}`
    : null

  const summary = (
    <div className="flex-1 min-w-0">
      <p className="font-semibold text-slate-800 flex items-center gap-2">
        <span className="text-xl leading-none shrink-0" aria-hidden="true">{getSportIcon(sport.name)}</span>
        <span className="truncate">{sport.name}</span>
      </p>
      <p className="text-xs text-gray-400 mt-0.5">
        {pendingCount === 0
          ? 'No pending matches'
          : `${pendingCount} pending match${pendingCount !== 1 ? 'es' : ''}`}
      </p>
    </div>
  )

  const countPill = pendingCount > 0 && (
    <span className="shrink-0 text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
      {pendingCount}
    </span>
  )

  // Sports with a dedicated results page: the whole card is a link.
  if (destination) {
    return (
      <Link
        to={destination}
        className="flex items-center gap-3 px-4 py-4 bg-white rounded-xl border border-gray-100 shadow-sm active:bg-gray-50 transition-colors"
      >
        {summary}
        {countPill}
        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    )
  }

  // Fallback: sports with no dedicated page expand to an inline match list.
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-4 text-left active:bg-gray-50 transition-colors"
      >
        {summary}
        {countPill}
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-4">
          {matches.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-2">No pending matches.</p>
          ) : (
            <ul className="space-y-2">
              {matches.map(match => (
                <li key={match.id} className="bg-gray-50 rounded-lg px-3 py-2.5">
                  <p className="text-sm font-semibold text-slate-800">
                    {teamLabel(match.home_team_id, teamMap, companyMap)}{' '}
                    <span className="text-gray-400 font-normal">vs</span>{' '}
                    {teamLabel(match.away_team_id, teamMap, companyMap)}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {match.locations?.name ? `${match.locations.name} · ` : ''}
                    {match.scheduled_at
                      ? new Date(match.scheduled_at).toLocaleString(undefined, {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : 'No time set'}
                    {match.status === 'in_progress' && (
                      <span className="ml-2 text-amber-600 font-medium">In progress</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default function ResultsPage() {
  const { data: allMatches = [], isLoading } = useQuery({
    queryKey: ['matches'],
    queryFn: () => getMatches(),
  })
  const { data: teams = [] } = useQuery({
    queryKey: ['teams'],
    queryFn: () => getTeams(),
    staleTime: Infinity,
  })
  const { data: sports = [] } = useQuery({
    queryKey: ['sports'],
    queryFn: getSports,
    staleTime: Infinity,
  })
  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: getCompanies,
    staleTime: Infinity,
  })

  const teamMap    = useMemo(() => indexBy(teams,     'id') as Record<string, Team>,    [teams])
  const companyMap = useMemo(() => indexBy(companies, 'id') as Record<string, Company>, [companies])

  const activeMatches = useMemo(
    () => allMatches.filter(m => m.status === 'scheduled' || m.status === 'in_progress'),
    [allMatches],
  )

  const matchesBySport = useMemo(() => {
    const map = new Map<string, Match[]>()
    for (const match of activeMatches) {
      const list = map.get(match.sport_id) ?? []
      list.push(match)
      map.set(match.sport_id, list)
    }
    return map
  }, [activeMatches])

  const sportsWithMatches = useMemo(
    () =>
      sports
        .filter(s => matchesBySport.has(s.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [sports, matchesBySport],
  )

  if (isLoading) {
    return (
      <div className="p-4 mt-2 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-gray-200 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-4 mt-2 space-y-3">
      <div className="flex items-center gap-2">
        <Link to="/manage" className="text-blue-600 text-sm">← Manage</Link>
      </div>
      <h2 className="text-xl font-bold text-slate-800">Enter Results</h2>

      {sportsWithMatches.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No pending matches.</p>
      ) : (
        sportsWithMatches.map(sport => (
          <SportRow
            key={sport.id}
            sport={sport}
            matches={matchesBySport.get(sport.id) ?? []}
            teamMap={teamMap}
            companyMap={companyMap}
          />
        ))
      )}
    </div>
  )
}
