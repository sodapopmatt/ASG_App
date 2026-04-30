import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getSports } from '../../api/sports'
import { getTeams } from '../../api/teams'

const BRACKET_LABELS: Record<string, string> = {
  single_elimination: 'Single elim',
  double_elimination: 'Double elim',
  pool_bracket: 'Pool + bracket',
  pool_swiss: 'Pool + Swiss',
  heats: 'Heats',
  points_based: 'Points based',
}

export default function BracketsPage() {
  const { data: sports = [], isLoading } = useQuery({
    queryKey: ['sports'],
    queryFn: getSports,
    staleTime: Infinity,
  })
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })

  const [sportFilter, setSportFilter] = useState<string | null>(null)

  const teamCountBySport = useMemo(() => {
    const map = new Map<string, number>()
    for (const team of teams) {
      map.set(team.sport_id, (map.get(team.sport_id) ?? 0) + 1)
    }
    return map
  }, [teams])

  const filteredSports = sportFilter ? sports.filter(s => s.id === sportFilter) : sports

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
        <Link to="/manage" className="text-blue-600 text-sm">← Manage</Link>
      </div>
      <h2 className="text-xl font-bold text-slate-800 mb-2">Matches</h2>

      {/* Sport filter chips */}
      <div className="flex flex-wrap gap-2 pb-1">
        <button
          onClick={() => setSportFilter(null)}
          className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
            sportFilter === null
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-slate-600 border-gray-200'
          }`}
        >
          All
        </button>
        {sports.map(sport => (
          <button
            key={sport.id}
            onClick={() => setSportFilter(sport.id === sportFilter ? null : sport.id)}
            className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
              sportFilter === sport.id
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-gray-200'
            }`}
          >
            {sport.name}
          </button>
        ))}
      </div>

      {/* Sport rows */}
      {filteredSports.map(sport => {
        const teamCount = teamCountBySport.get(sport.id) ?? 0
        return (
          <div key={sport.id} className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800">{sport.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {BRACKET_LABELS[sport.bracket_type] ?? sport.bracket_type}
                  {' · '}
                  {teamCount} team{teamCount !== 1 ? 's' : ''}
                </p>
              </div>
              <Link
                to={`/manage/brackets/${sport.id}`}
                className="shrink-0 text-sm font-medium text-blue-600"
              >
                Configure →
              </Link>
            </div>
          </div>
        )
      })}
    </div>
  )
}
