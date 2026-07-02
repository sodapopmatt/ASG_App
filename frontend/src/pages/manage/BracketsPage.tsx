import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import BackLink from '../../components/BackLink'
import { useQuery } from '@tanstack/react-query'
import { getSports } from '../../api/sports'
import { getTeams } from '../../api/teams'
import { getSportIcon } from '../../lib/sportIcons'
import { BRACKET_TYPE_LABELS } from '../BracketsSportIndex'

export default function BracketsPage() {
  const { data: sports = [], isLoading } = useQuery({
    queryKey: ['sports'],
    queryFn: getSports,
    staleTime: Infinity,
  })
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })

  const teamCountBySport = useMemo(() => {
    const map = new Map<string, number>()
    for (const team of teams) {
      map.set(team.sport_id, (map.get(team.sport_id) ?? 0) + 1)
    }
    return map
  }, [teams])

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
      <div className="flex items-center gap-2">
        <BackLink to="/manage" label="Manage" />
      </div>
      <h2 className="text-xl font-bold text-slate-800 mb-2">Matches</h2>

      {/* Sport rows */}
      {sports.map(sport => {
        const teamCount = teamCountBySport.get(sport.id) ?? 0
        return (
          <Link
            key={sport.id}
            to={`/manage/brackets/${sport.id}`}
            className="block bg-white rounded-xl border border-gray-100 shadow-sm hover:bg-gray-50 active:bg-gray-100 transition-colors"
          >
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 flex items-center gap-2">
                  <span className="text-xl leading-none shrink-0" aria-hidden="true">{getSportIcon(sport.name)}</span>
                  <span className="truncate">{sport.name}</span>
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {BRACKET_TYPE_LABELS[sport.bracket_type] ?? sport.bracket_type}
                  {' · '}
                  {teamCount} team{teamCount !== 1 ? 's' : ''}
                </p>
              </div>
              <span className="shrink-0 text-gray-300 text-lg">›</span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
