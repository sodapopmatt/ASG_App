import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getSports } from '../api/sports'
import type { Sport } from '../types'

const BRACKET_TYPE_LABELS: Record<string, string> = {
  single_elimination: 'Single Elimination',
  double_elimination: 'Double Elimination',
  pool_bracket: 'Pool + Bracket',
  pool_swiss: 'Pool (Swiss)',
  heats: 'Heats',
  points_based: 'Points Based',
}

function SportCard({ sport }: { sport: Sport }) {
  const navigate = useNavigate()
  const label = BRACKET_TYPE_LABELS[sport.bracket_type] ?? sport.bracket_type

  return (
    <button
      onClick={() => navigate(`/brackets/${sport.id}`)}
      className="w-full text-left bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-4 flex items-center justify-between gap-3 active:bg-gray-50 transition-colors"
    >
      <span className="font-semibold text-slate-800 text-base">{sport.name}</span>
      <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full shrink-0">{label}</span>
    </button>
  )
}

export default function BracketsSportIndex() {
  const sportsQuery = useQuery({ queryKey: ['sports'], queryFn: getSports, staleTime: Infinity })
  const sports = sportsQuery.data ?? []

  if (sportsQuery.isLoading) {
    return (
      <div className="p-4 mt-2 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-gray-200 animate-pulse" />
        ))}
      </div>
    )
  }

  if (sports.length === 0) {
    return <p className="text-center text-gray-500 py-16">No sports found.</p>
  }

  return (
    <div className="p-4 mt-2 space-y-3">
      {sports.map(sport => (
        <SportCard key={sport.id} sport={sport} />
      ))}
    </div>
  )
}
